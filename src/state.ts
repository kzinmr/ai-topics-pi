import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { writeJson } from './files.js';
import type { RunRow } from './types.js';

/** A separate SQLite write transaction is a process-scoped profile mutex.
 * The OS releases it even on SIGKILL; runs.db remains free for run checkpoints. */
export function lockProfile(state: string): () => void {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(state, 'lock.db'));
  try { db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); }
  catch { db.close(); throw new Error('profile is busy; another writer holds the lock'); }
  return () => { db.exec('ROLLBACK'); db.close(); };
}
export async function withProfileLock<T>(state: string, work: () => Promise<T> | T): Promise<T> {
  const release = lockProfile(state);
  try { return await work(); } finally { release(); }
}
export class Store {
  readonly db: DatabaseSync;
  constructor(state: string) {
    mkdirSync(state, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(state, 'runs.db'));
    this.db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, job TEXT NOT NULL, started TEXT NOT NULL,
        finished TEXT, status TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(job TEXT, slot TEXT, PRIMARY KEY(job,slot));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  close(): void { this.db.close(); }
  claim(job: string, slot: string): boolean {
    // Canonicalize via SQLite time to recognize existing ISO offsets too.
    if (this.db.prepare('SELECT 1 FROM claims WHERE job=? AND julianday(slot)=julianday(?)').get(job, slot)) return false;
    return this.db.prepare('INSERT OR IGNORE INTO claims VALUES(?,?)').run(job, slot).changes === 1;
  }
  start(id: string, job: string, at: string): void { this.db.prepare("INSERT INTO runs VALUES(?,?,?,NULL,'running','{}')").run(id, job, at); }
  finish(id: string, at: string, status: string, detail: unknown): void { this.db.prepare('UPDATE runs SET finished=?,status=?,detail=? WHERE id=?').run(at, status, JSON.stringify(detail), id); }
  latest(job: string): RunRow | undefined { return this.db.prepare('SELECT * FROM runs WHERE job=? ORDER BY julianday(started) DESC,rowid DESC LIMIT 1').get(job) as RunRow | undefined; }
  getMeta(key: string): string | undefined { return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value: string} | undefined)?.value; }
  setMeta(key: string, value: string): void { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key, value); }
  requireIdle(): void { if (this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()) throw new Error('interrupted runs exist; inspect status and use recover'); }
  view(cfg: Config): void {
    writeJson(join(cfg.state, 'jobs-view.json'), { jobs: cfg.jobs.map(job => {
      const last = this.latest(job.name);
      return { id: job.name, name: job.name, enabled: job.enabled,
        schedule: {kind: 'cron', expr: job.schedule}, state: job.enabled ? 'scheduled' : 'paused',
        last_status: last ? (['ok','skipped'].includes(last.status) ? 'ok' : last.status) : null,
        last_run_at: last?.finished ?? null, last_error: last?.status === 'error' ? last.detail : null };
    }) });
  }
}
