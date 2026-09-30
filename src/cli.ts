import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Config, validatePi } from './config.js';
import { agentRequest, listModels, runWorker } from './agent.js';
import { errorText, inside, readJson } from './files.js';
import { initialize, requireProfile } from './profile.js';
import { importState } from './migrate.js';
import { promptFor, run, tick } from './runner.js';
import { Store, withProfileLock } from './state.js';
import { execute, installSignalHandlers } from './process.js';
import { deliver, notify, type Envelope } from './delivery.js';
import { publish } from './publish.js';
import { search } from './search.js';

const help = `Usage: wiki [--profile PATH] COMMAND
  init [--content-source URL|PATH]   Initialize an empty profile
  import-state SOURCE              Import collector state from Lucy
  validate | doctor | jobs | status
  run JOB [--dry-run] | tick
  pi [--list-models | --print TEXT] [--provider NAME --model ID --thinking LEVEL]
  script NAME.py [ARGS...] | search QUERY | outbox [--deliver] | publish
  recover RUN_ID | reset-cursor | systemd-service
`;
async function dispatch(cfg: Config, command: string, args: string[]): Promise<unknown> {
  const parse = (options: NonNullable<Parameters<typeof parseArgs>[0]>['options'] = {}) => parseArgs({args, options, allowPositionals: true});
  if (command === 'validate') return {valid: true, jobs: cfg.jobs.length, enabled: cfg.jobs.filter(j => j.enabled).length};
  if (command === 'jobs') return cfg.jobs;
  if (command === 'systemd-service') {
    const escape = (value: string): string => {
      if (/[\r\n]/.test(value)) throw new Error('systemd paths cannot contain newlines');
      return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
    };
    process.stdout.write(readFileSync(join(cfg.source, 'deploy/wiki.service.in'), 'utf8')
      .replaceAll('@PROFILE@', escape(cfg.profile)).replaceAll('@SOURCE@', escape(cfg.source).replaceAll('$', '$$')));
    return;
  }
  if (command === 'init') return initialize(cfg, parse({'content-source': {type: 'string'}}).values['content-source'] as string | undefined);
  if (command === 'import-state') { if (args.length !== 1) throw new Error('import-state requires source profile'); return importState(cfg, args[0]!); }
  if (command === 'run') {
    const parsed = parse({'dry-run': {type: 'boolean'}});
    const job = cfg.job(parsed.positionals[0] ?? '');
    if (parsed.values['dry-run']) return {job, cwd: cfg.repo, sdk: agentRequest(cfg, job), prompt: promptFor(cfg, job, '(not collected in dry-run)')};
    return run(cfg, job.name);
  }
  if (command === 'tick') return tick(cfg);
  requireProfile(cfg);
  if (command === 'doctor') {
    const checks = {sdk: existsSync(join(cfg.source, 'node_modules/@earendil-works/pi-coding-agent/package.json')),
      schema: existsSync(join(cfg.wiki, 'SCHEMA.md')), index: existsSync(join(cfg.wiki, 'index.md')),
      models: existsSync(join(cfg.profile, '.pi/agent/models.json')), git: false, python: false};
    for (const [key, argv] of [['git', ['git','--version']], ['python', [cfg.python(),'--version']]] as const) {
      try { await execute([...argv], {cwd: cfg.repo, env: cfg.env(), timeout: 10}); checks[key] = true; } catch { /* reported below */ }
    }
    return {status: Object.values(checks).every(Boolean) ? 'ok' : 'error', checks, note: 'Offline checks only; use wiki pi --list-models and a model smoke test.'};
  }
  if (command === 'script') {
    const name = args.shift();
    if (!name?.endsWith('.py')) throw new Error('script requires a maintained .py file');
    await execute([cfg.python(), inside(cfg.scripts, name), ...args], {cwd: cfg.repo, env: cfg.env(), timeout: 3600, inherit: true});
    return;
  }
  if (command === 'search') { process.stdout.write(await search(args.join(' '), cfg.env(), cfg.repo)); return; }
  if (command === 'notify') { await notify(JSON.parse(readFileSync(0, 'utf8')) as Envelope, cfg.env()); return; }
  if (command === 'pi') {
    if (args[0] === '--') args.shift();
    const parsed = parse({print: {type: 'string'}, 'list-models': {type: 'boolean'}, provider: {type: 'string'}, model: {type: 'string'}, thinking: {type: 'string'}});
    const pi = {...cfg.local.pi};
    for (const key of ['provider','model','thinking'] as const) if (parsed.values[key]) (pi as Record<string,unknown>)[key] = parsed.values[key];
    validatePi(pi);
    return withProfileLock(cfg.state, async () => {
      if (parsed.values['list-models']) return listModels(cfg, pi);
      const request = {...agentRequest(cfg), pi};
      if (parsed.values.print) return runWorker(cfg, {...request, prompt: parsed.values.print as string}, 3600);
      if (!process.stdin.isTTY) throw new Error('interactive Pi requires a terminal; use --print TEXT');
      return runWorker(cfg, {...request, mode: 'interactive'}, Infinity);
    });
  }
  if (command === 'publish') return withProfileLock(cfg.state, () => publish(cfg));
  if (command === 'outbox') {
    const send = parse({deliver: {type: 'boolean'}}).values.deliver;
    return withProfileLock(cfg.state, async () => {
      const result = [];
      for (const file of readdirSync(join(cfg.state, 'outbox')).filter(f => f.endsWith('.json')).sort()) {
        const path = join(cfg.state, 'outbox', file);
        result.push(send ? await deliver(cfg, path) : readJson(path));
      }
      return result;
    });
  }
  return withProfileLock(cfg.state, () => {
    const store = new Store(cfg.state);
    try {
      if (command === 'status') return Object.fromEntries(cfg.jobs.map(j => [j.name, store.latest(j.name) ?? null]));
      if (command === 'recover') {
        const id = args[0];
        if (!id || !(store.db.prepare("SELECT 1 FROM runs WHERE id=? AND status='running'").get(id))) throw new Error('run is not interrupted/running');
        store.finish(id, new Date().toISOString(), 'error', {error: 'operator acknowledged interrupted run; no automatic replay'}); store.view(cfg);
        return {recovered: id};
      }
      if (command === 'reset-cursor') {
        const slot = new Date(Math.floor(Date.now()/60000)*60000).toISOString(); store.setMeta('cursor', slot); return {cursor: slot};
      }
      throw new Error(`unknown command: ${command}`);
    } finally { store.close(); }
  });
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  installSignalHandlers();
  process.umask(0o077);
  let cfg: Config | undefined;
  try {
    let profile;
    if (argv[0] === '--profile') { argv.shift(); profile = argv.shift(); if (!profile) throw new Error('--profile requires a path'); }
    const command = argv.shift();
    if (!command || command === '--help' || command === '-h') { console.log(help); return; }
    cfg = new Config({profile});
    const result = await dispatch(cfg, command, argv);
    if (result !== undefined && result !== null) console.log(JSON.stringify(result, null, 2));
    if ((Array.isArray(result) ? result : [result]).some(r => r && ['error','failed'].includes(r.status))) process.exitCode = 1;
  } catch (error) { console.error(cfg ? cfg.redact(errorText(error)) : errorText(error)); process.exitCode = 1; }
}
await main();
