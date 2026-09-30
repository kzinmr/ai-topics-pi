/** One-way import of source collector state, excluding credentials and scheduler data. */
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { expandHome } from './config.js';
import { readJson, within, writeJson } from './files.js';
import { requireProfile } from './profile.js';
import { withProfileLock } from './state.js';

function jsonFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink()) throw new Error('state import refuses symlinks');
  return readdirSync(root, {withFileTypes: true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('state import refuses symlinks');
    const path = join(root, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith('.json') ? [path] : [];
  });
}
export async function importState(cfg: Config, input: string): Promise<unknown> {
  requireProfile(cfg);
  const source = realpathSync(resolve(expandHome(input)));
  if (within(source, cfg.profile) || within(cfg.profile, source)) throw new Error('source and destination profiles must be independent');
  const old = join(source, '.hermes');
  if (!existsSync(old)) throw new Error('source is not a Lucy profile');
  const data = join(old, 'cron/data');
  const paths = readdirSync(old).filter(n => /^processed_.*\.json$/.test(n)).map(n => join(old, n));
  for (const folder of ['blog_ingest','newsletter','dreaming','sitemap_monitor','raw_backlog','x_accounts_archive','x_bookmarks_archive']) paths.push(...jsonFiles(join(data, folder)));
  if (existsSync(data)) paths.push(...readdirSync(data).filter(n => /^x_.*\.json$/.test(n)).map(n => join(data, n)));
  const rebase = (value: any): any => {
    if (Array.isArray(value)) return value.map(rebase);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,rebase(v)]));
    if (typeof value === 'string') for (const prefix of [source, '/opt/data']) {
      if (!value.startsWith(prefix + '/')) continue;
      const suffix = value.slice(prefix.length + 1);
      if (suffix.startsWith('.hermes/cron/data/')) return join(cfg.state, 'data', suffix.slice('.hermes/cron/data/'.length));
      if (suffix.startsWith('.hermes/')) return join(cfg.state, suffix.slice('.hermes/'.length));
      return join(cfg.profile, suffix);
    }
    return value;
  };
  const planned = paths.map(path => {
    if (lstatSync(path).isSymbolicLink() || !within(realpathSync(old), realpathSync(path))) throw new Error('state import refuses external symlinks');
    return {destination: join(cfg.state, within(data, path) ? join('data', relative(data, path)) : relative(old, path)), value: rebase(readJson(path))};
  });
  const database = join(source, '.blogwatcher/blogwatcher.db');
  const target = join(cfg.profile, '.blogwatcher/blogwatcher.db');
  return withProfileLock(cfg.state, async () => {
    if (existsSync(join(cfg.state, 'import.json')) || existsSync(target) || planned.some(p => existsSync(p.destination))) throw new Error('destination already has imported/collector state; use an unused profile');
    if (existsSync(database)) {
      mkdirSync(dirname(target), {recursive: true});
      const db = new DatabaseSync(database, {readOnly: true});
      try { await backup(db, target); } finally { db.close(); }
      chmodSync(target, 0o600);
    }
    for (const item of planned) writeJson(item.destination, item.value);
    const report = {json_files: planned.length, rss_database: existsSync(database), note: 'Stop source collection for a consistent final cutover. Source untouched.'};
    writeJson(join(cfg.state, 'import.json'), report);
    return report;
  });
}
