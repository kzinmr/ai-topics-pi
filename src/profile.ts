import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { atomicWrite, readJson, writeJson } from './files.js';
import { execute } from './process.js';

export function requireProfile(cfg: Config): void {
  if (!existsSync(join(cfg.state, 'profile.json'))) throw new Error('profile is not initialized; run init on an empty profile');
  if (!existsSync(cfg.wiki) || realpathSync(cfg.wiki) !== realpathSync(join(cfg.repo, 'wiki'))) throw new Error('~/wiki must resolve to the content repository wiki');
  if (!existsSync(join(cfg.state, 'scripts')) || realpathSync(join(cfg.state, 'scripts')) !== realpathSync(cfg.scripts)) throw new Error('code checkout moved; relink profile/.ai-topics/scripts to scripts/');
}
export async function initialize(cfg: Config, contentSource?: string): Promise<unknown> {
  if (existsSync(cfg.profile) && readdirSync(cfg.profile).length) throw new Error('init requires an empty destination profile');
  mkdirSync(cfg.profile, {recursive: true, mode: 0o700});
  mkdirSync(cfg.state, {mode: 0o700});
  mkdirSync(join(cfg.profile, '.pi/agent'), {recursive: true, mode: 0o700});
  mkdirSync(join(cfg.profile, 'bin'));
  if (contentSource) {
    // Bootstrap Git uses the operator's credentials; all job processes use the profile.
    await execute(['git', 'clone', '--no-hardlinks', contentSource, cfg.repo], {cwd: cfg.source, env: process.env, timeout: 600});
    await execute(['git', '-C', cfg.repo, 'remote', 'set-url', 'origin', 'https://github.com/kzinmr/ai-topics.git'], {cwd: cfg.source, env: process.env, timeout: 30});
  } else mkdirSync(join(cfg.repo, 'wiki'), {recursive: true});
  symlinkSync('ai-topics/wiki', cfg.wiki, 'dir');
  symlinkSync(cfg.scripts, join(cfg.state, 'scripts'), 'dir');
  for (const dir of ['data', 'runs', 'outbox', 'sessions']) mkdirSync(join(cfg.state, dir), {mode: 0o700});
  const instructions = join(cfg.repo, 'AGENTS.md');
  if (existsSync(instructions)) copyFileSync(instructions, join(cfg.state, 'original-AGENTS.md'));
  atomicWrite(instructions, readFileSync(join(cfg.source, 'config/AGENTS.md'), 'utf8'), 0o644);
  writeJson(cfg.localPath, readJson(join(cfg.source, 'config/local.example.json')));
  writeJson(join(cfg.profile, '.pi/agent/models.json'), readJson(join(cfg.source, 'config/models.example.json')));
  if (existsSync(join(cfg.repo, '.git'))) await execute(['git', 'config', 'core.hooksPath', '.githooks'], {cwd: cfg.repo, env: cfg.env(), timeout: 30});
  writeJson(join(cfg.state, 'profile.json'), {version: 1, runtime: 'pi'});
  return {profile: cfg.profile, content: cfg.repo};
}
