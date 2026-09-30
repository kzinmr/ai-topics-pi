import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, readJson } from './files.js';
import { cronMatches } from './schedule.js';
import type { Job, LocalConfig, PiSettings } from './types.js';

export function expandHome(path: string): string { return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path; }
export class Config {
  readonly source: string;
  readonly profile: string;
  readonly repo: string;
  readonly wiki: string;
  readonly state: string;
  readonly scripts: string;
  readonly localPath: string;
  local: LocalConfig;
  jobs: Job[];
  constructor(options: {source?: string; profile?: string} = {}) {
    this.source = resolve(options.source ?? process.env.AI_TOPICS_SOURCE ?? fileURLToPath(new URL('..', import.meta.url)));
    this.profile = resolve(expandHome(options.profile ?? process.env.AI_TOPICS_PROFILE ?? join(this.source, 'profiles/lucy')));
    this.repo = join(this.profile, 'ai-topics'); this.wiki = join(this.profile, 'wiki');
    this.state = join(this.profile, '.ai-topics'); this.scripts = join(this.source, 'scripts');
    this.localPath = join(this.state, 'local.json');
    this.local = existsSync(this.localPath) ? readJson(this.localPath) : {};
    const manifest = readJson(join(this.source, 'config/jobs.json'));
    if (manifest.version !== 1 || manifest.timezone !== 'UTC' || !Array.isArray(manifest.jobs)) throw new Error('jobs version=1 and timezone=UTC required');
    this.jobs = manifest.jobs;
    this.validate();
  }
  job(name: string): Job {
    const job = this.jobs.find(j => j.name === name);
    if (!job) throw new Error(`unknown job: ${name}`);
    return job;
  }
  validate(): void {
    if (new Set(this.jobs.map(j => j.name)).size !== this.jobs.length) throw new Error('duplicate job names');
    for (const job of this.jobs) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(job.name)) throw new Error('invalid job name');
      cronMatches(job.schedule, new Date());
      if (typeof job.enabled !== 'boolean' || typeof job.no_agent !== 'boolean') throw new Error('enabled/no_agent must be boolean');
      if (job.no_agent && !job.script) throw new Error('no_agent requires script');
      if (job.script && !statSync(inside(this.scripts, job.script)).isFile()) throw new Error(`missing script: ${job.script}`);
      if (!statSync(inside(this.source, job.prompt)).isFile()) throw new Error(`missing prompt: ${job.name}`);
      for (const skill of job.skills) if (!statSync(inside(join(this.source, 'skills'), `${skill}/SKILL.md`)).isFile()) throw new Error(`missing skill: ${skill}`);
      for (const name of job.depends_on) this.job(name);
      for (const value of [job.timeout_seconds, job.script_timeout_seconds, job.max_dependency_age_hours]) if (!Number.isFinite(value) || value <= 0) throw new Error('invalid job timeout/freshness');
      if (!['text', 'json'].includes(job.response_format)) throw new Error('invalid response_format');
    }
    const visit = (name: string, stack: string[]): void => {
      if (stack.includes(name)) throw new Error('dependency cycle');
      for (const dep of this.job(name).depends_on) visit(dep, [...stack, name]);
    };
    for (const job of this.jobs) visit(job.name, []);
    for (const settings of [this.local.pi, ...this.jobs.map(j => j.pi)]) validatePi(settings ?? {});
    if (this.local.publish !== undefined && typeof this.local.publish !== 'boolean') throw new Error('publish must be boolean');
    const gap = this.local.max_catchup_minutes ?? 1440;
    if (!Number.isInteger(gap) || gap <= 0) throw new Error('max_catchup_minutes must be a positive integer');
  }
  python(): string { return this.local.python ?? process.env.AI_TOPICS_PYTHON ?? (existsSync(join(this.source, '.venv/bin/python')) ? join(this.source, '.venv/bin/python') : 'python3'); }
  env(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of ['CODEX_HOME', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'PYTHONPATH']) delete env[key];
    const secretPath = join(this.state, 'secrets.json');
    const secrets = existsSync(secretPath) ? readJson<Record<string, string>>(secretPath) : {};
    for (const values of [secrets, this.local.environment ?? {}]) {
      if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.values(values).every(v => typeof v === 'string')) throw new Error('environment/secrets must map names to strings');
      Object.assign(env, values);
    }
    Object.assign(env, { HOME: this.profile, AI_TOPICS_PROFILE: this.profile, AI_TOPICS_STATE: this.state,
      AI_TOPICS_SOURCE: this.source, AI_TOPICS_REPO: this.repo, AI_TOPICS_HOME: this.repo,
      WIKI_ROOT: this.wiki, WIKI_PATH: this.wiki, AI_TOPICS_JOBS_FILE: join(this.state, 'jobs-view.json'),
      AI_TOPICS_SKILLS: join(this.source, 'skills'), PI_CODING_AGENT_DIR: join(this.profile, '.pi/agent'), PI_OFFLINE: '1', TZ: 'UTC' });
    env.PATH = [join(this.source, 'bin'), join(this.source, '.venv/bin'), join(this.profile, 'bin'), env.PATH ?? ''].join(delimiter);
    return env;
  }
  redact(text: string): string {
    for (const [name, value] of Object.entries(this.env())) if (/TOKEN|PASSWORD|SECRET|API_KEY/i.test(name) && value && value.length >= 6) text = text.split(value).join('[REDACTED]');
    return text;
  }
}
export function validatePi(settings: PiSettings): void {
  for (const key of ['provider', 'model', 'thinking'] as const) if (settings[key] !== undefined && typeof settings[key] !== 'string') throw new Error(`pi.${key} must be a string`);
  if (settings.thinking && !['off','minimal','low','medium','high','xhigh','max'].includes(settings.thinking)) throw new Error('invalid thinking level');
  if (settings.extensions && (!Array.isArray(settings.extensions) || !settings.extensions.every(x => typeof x === 'string'))) throw new Error('pi.extensions must be a list of paths');
}
