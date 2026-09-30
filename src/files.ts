import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export function readJson<T = any>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }
export function atomicWrite(path: string, text: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', mode);
  try { writeFileSync(fd, text); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function writeJson(path: string, value: unknown): void { atomicWrite(path, JSON.stringify(value, null, 2) + '\n'); }
export function within(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
export function inside(root: string, name: string): string {
  const path = resolve(root, name);
  if (!within(root, path) || (existsSync(path) && !within(realpathSync(root), realpathSync(path)))) {
    throw new Error(`path escapes root: ${name}`);
  }
  return path;
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
