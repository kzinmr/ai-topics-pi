/** OS boundary for Pi tools. The SDK/authentication process stays on the host. */
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import type { AgentRequest } from './types.js';

export const researchJobs = ['active-crawl', 'trending-topics', 'x-bookmarks-ingest', 'x-accounts-scan',
  'skeleton-enrich-daily', 'llm-pricing-monitor', 'dreaming-collect'];
export const readOnlyJobs = ['blog-triage', 'newsletter-triage', 'dreaming-group', 'wiki-health'];
export function networkAllowed(request: AgentRequest): boolean {
  return !!request.job && (request.pi.network_jobs ?? researchJobs).includes(request.job);
}
export function sandboxArgs(request: AgentRequest): string[] {
  if (process.platform !== 'linux') throw new Error('Pi tool sandbox requires Linux (Windows: WSL2).');
  const {source, profile, repo, state} = request;
  if (source === profile || source.startsWith(profile + '/')) throw new Error('Code checkout must be outside the profile');
  const wiki = join(repo, 'wiki'), scratch = join(state, 'work');
  // Mount destinations must not follow operator-created symlinks outside the profile.
  for (const path of [source, profile, repo, state, wiki]) {
    if (realpathSync(path) !== path) throw new Error(`sandbox requires a canonical directory: ${path}`);
  }
  for (const path of [scratch, join(wiki, 'raw'), join(wiki, 'raw/articles'), join(wiki, 'transcripts')]) {
    mkdirSync(path, {recursive: true, mode: 0o700});
    if (realpathSync(path) !== path) throw new Error(`sandbox mount cannot be a symlink: ${path}`);
  }
  const args = ['--unshare-all', '--die-with-parent', '--new-session'];
  if (networkAllowed(request)) args.push('--share-net');
  const ro = (path: string, target = path): void => { if (existsSync(path)) args.push('--ro-bind', path, target); };
  ro('/usr');
  for (const path of ['/bin', '/sbin', '/lib', '/lib64']) {
    if (!existsSync(path)) continue;
    if (lstatSync(path).isSymbolicLink()) args.push('--symlink', readlinkSync(path), path);
    else ro(path);
  }
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp');
  for (const path of ['/etc/ssl/certs', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/ld.so.cache']) ro(path);
  // Only public runtime assets are exposed, never the checkout/profile as a whole.
  for (const name of ['dist', 'node_modules', 'package.json', 'config', 'scripts', 'skills', 'prompts', 'bin', '.venv']) ro(join(source, name));
  // uv/mise/CI Python distributions keep their standard library beside bin/.
  if (request.python) {
    for (const executable of [request.python, realpathSync(request.python)]) {
      const runtime = dirname(dirname(executable));
      if (runtime === '/usr' || runtime.startsWith('/usr/')) continue;
      if (!existsSync(join(runtime, 'lib')) || !executable.startsWith(join(runtime, 'bin') + '/')) {
        throw new Error('Sandbox Python must belong to a Python installation or virtualenv with bin/ and lib/');
      }
      // Bind only bin/lib, not configuration or unrelated files at the installation root.
      ro(join(runtime, 'bin')); ro(join(runtime, 'lib'));
      ro(join(runtime, 'pyvenv.cfg'));
    }
  }
  ro(realpathSync(process.execPath), '/opt/wiki-runtime/node');
  args.push('--tmpfs', profile, '--dir', repo, '--dir', state,
    readOnlyJobs.includes(request.job ?? '') ? '--ro-bind' : '--bind', wiki, wiki,
    '--ro-bind', join(wiki, 'raw'), join(wiki, 'raw'),
    '--ro-bind', join(wiki, 'transcripts'), join(wiki, 'transcripts'),
    '--symlink', 'ai-topics/wiki', join(profile, 'wiki'),
    '--bind', scratch, scratch, '--symlink', join(source, 'scripts'), join(state, 'scripts'));
  for (const name of ['data', 'profile.json', 'jobs-view.json', ...readdirSync(state).filter(n => /^processed_[\w-]+\.json$/.test(n))]) ro(join(state, name));
  // Everything except the explicit writable mounts is immutable, including the synthetic HOME.
  args.push('--remount-ro', profile, '--remount-ro', '/', '--clearenv');
  const env: Record<string, string> = {
    HOME: profile, PATH: `/opt/wiki-runtime:${source}/bin:${source}/.venv/bin:/usr/local/bin:/usr/bin:/bin`,
    LANG: 'C.UTF-8', TZ: 'UTC', TMPDIR: scratch, PYTHONDONTWRITEBYTECODE: '1',
    AI_TOPICS_PROFILE: profile, AI_TOPICS_SOURCE: source, AI_TOPICS_STATE: state,
    AI_TOPICS_REPO: repo, AI_TOPICS_HOME: repo, WIKI_ROOT: join(profile, 'wiki'),
    WIKI_PATH: join(profile, 'wiki'), WIKI_WORK_DIR: scratch, PI_OFFLINE: '1',
  };
  if (request.python) env.AI_TOPICS_PYTHON = request.python;
  for (const [key, value] of Object.entries(env)) args.push('--setenv', key, value);
  args.push('--chdir', repo, '--', '/opt/wiki-runtime/node', join(source, 'dist/tool-worker.js'));
  return args;
}

/** JSON over pipes is data; no shell interpolation and no host tool fallback. */
export async function sandboxTool(request: AgentRequest, name: string, params: unknown,
  signal?: AbortSignal, timeout = 120): Promise<any> {
  signal?.throwIfAborted();
  const args = sandboxArgs(request);
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/bwrap', args, {
      cwd: request.repo, env: {PATH: '/usr/bin:/bin'}, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', stderr = '', failure: Error | undefined;
    const stop = (error: Error): void => { failure ??= error; child.kill('SIGKILL'); };
    const abort = (): void => stop(new Error('Sandbox tool aborted'));
    signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => stop(new Error('Sandbox tool timed out')), timeout * 1000);
    child.stdout.setEncoding('utf8').on('data', text => {
      output += text;
      if (Buffer.byteLength(output) > 20 * 1024 * 1024) stop(new Error('Sandbox tool output limit exceeded'));
    });
    child.stderr.setEncoding('utf8').on('data', text => { stderr = (stderr + text).slice(-4000); });
    child.on('error', error => { failure = error; });
    child.stdin.on('error', () => { /* close reports a failed sandbox launch */ });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`Sandbox failed (${code}): ${stderr || output}`));
      try {
        const reply = JSON.parse(output);
        if (reply.error) reject(new Error(reply.error)); else resolve(reply.result);
      } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({name, params, cwd: request.repo}));
    if (signal?.aborted) abort();
  });
}

export async function checkSandbox(request: AgentRequest): Promise<void> {
  await sandboxTool(request, '$probe', {}, undefined, 15);
}

/** No model or external service: test real allow/deny operations against synthetic canaries. */
export async function probeSandbox(request: AgentRequest): Promise<Record<string, boolean>> {
  request = {...request, job: undefined};
  await checkSandbox(request);
  const dir = mkdtempSync(join(request.state, 'sandbox-probe-'));
  const name = dir.slice(dir.lastIndexOf('/') + 1);
  const control = join(dir, 'private'), auth = join(request.profile, '.pi/agent', name);
  const script = join(request.source, 'scripts/fetch_article.py'), wiki = join(request.repo, 'wiki', name);
  const raw = join(request.repo, 'wiki/raw', name), link = `${wiki}-link`;
  const scratch = join(request.state, 'work', name);
  const server = createServer(socket => socket.end());
  try {
    for (const path of [control, auth, raw]) writeFileSync(path, 'synthetic canary');
    symlinkSync(control, link);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Probe listener unavailable');
    const result = await sandboxTool(request, '$audit', {control, auth, script, wiki, raw, link, scratch, port: address.port});
    if (!Object.values(result).every(value => value === true)) throw new Error(`Sandbox boundary check failed: ${JSON.stringify(result)}`);
    return result;
  } finally {
    server.close();
    for (const path of [dir, auth, wiki, raw, link, scratch]) rmSync(path, {recursive: true, force: true});
  }
}
