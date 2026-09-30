import { spawn, type ChildProcess } from 'node:child_process';
import { errorText } from './files.js';

const active = new Set<ChildProcess>();
export function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
export function trackChild(child: ChildProcess): () => void {
  active.add(child);
  return () => active.delete(child);
}
export function installSignalHandlers(): void {
  for (const [signal, code] of [['SIGINT',130], ['SIGTERM',143]] as const) process.once(signal, () => {
    for (const child of active) killGroup(child, 'SIGTERM');
    setTimeout(() => { for (const child of active) killGroup(child, 'SIGKILL'); process.exit(code); }, 500);
  });
  process.on('exit', () => { for (const child of active) killGroup(child, 'SIGKILL'); });
}
export interface ExecuteOptions {
  cwd: string; env: NodeJS.ProcessEnv; timeout: number; input?: string; inherit?: boolean;
}
export function execute(argv: string[], options: ExecuteOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd, env: options.env, detached: true,
      stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    });
    const untrack = trackChild(child);
    let stdout = '', stderr = '', timedOut = false, force: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true; killGroup(child, 'SIGTERM');
      force = setTimeout(() => killGroup(child, 'SIGKILL'), 2000);
    }, options.timeout * 1000);
    child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr?.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.input);
    child.on('error', error => { clearTimeout(timer); if (force) clearTimeout(force); untrack(); reject(error); });
    child.on('exit', () => killGroup(child, 'SIGKILL'));
    child.on('close', (code, signal) => {
      clearTimeout(timer); if (force) clearTimeout(force); untrack();
      if (timedOut) reject(new Error(`process timeout: ${argv[0]}`));
      else if (code !== 0) reject(new Error(`${argv[0]} exited ${code ?? signal}: ${stderr}`));
      else resolve(stdout);
    });
  });
}
export async function postJson(url: string, payload: unknown, headers: Record<string,string> = {}): Promise<unknown> {
  try {
    const response = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json', ...headers},
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`delivery HTTP ${response.status}`);
    const data = response.status === 204 ? null : await response.json() as {ok?: boolean};
    if (data?.ok === false) throw new Error('provider rejected delivery');
    return data;
  } catch (error) { throw new Error(`delivery failed: ${errorText(error)}`); }
}
