import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { readJson, writeJson } from './files.js';
import type { JsonObject } from './types.js';

function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function parseJsonResponse(text: string): JsonObject {
  text = text.trim();
  if (text.startsWith('```')) {
    const match = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
    if (!match) throw new Error('expected one JSON object or JSON code block');
    text = match[1]!;
  }
  const result: unknown = JSON.parse(text);
  if (!object(result) || result.ok === false) throw new Error('expected a successful JSON object');
  return result;
}
export function validateTriage(name: string, result: JsonObject, source: JsonObject): void {
  const checkpoint = source.run_id ?? source._checkpoint?.run_id;
  if (!checkpoint || result.checkpoint_run_id !== checkpoint) throw new Error('response checkpoint_run_id does not match the input');
  if (name === 'dreaming-group') {
    if (!Array.isArray(result.groups)) throw new Error('group response requires groups array');
    const candidates = new Map<string, JsonObject>((source.articles ?? []).filter((a: JsonObject) => a.url).map((a: JsonObject) => [a.url, a]));
    for (const group of result.groups) {
      if (!object(group) || !Array.isArray(group.articles) || !group.theme) throw new Error('group requires theme and articles');
      for (const article of group.articles) {
        if (!object(article) || !candidates.has(article.url)) throw new Error('group contains an unknown article');
        Object.assign(article, candidates.get(article.url));
      }
    }
    return;
  }
  if (!Array.isArray(result.decisions)) throw new Error('triage response requires decisions array');
  const candidates = new Map<string, JsonObject>((source.candidates ?? []).map((c: JsonObject) => [c.item_id, c]));
  const seen = new Set<string>();
  for (const decision of result.decisions) {
    if (!object(decision) || !candidates.has(decision.item_id) || seen.has(decision.item_id)) throw new Error('unknown or duplicate triage item');
    seen.add(decision.item_id);
    if (!['take','reference','skip'].includes(decision.recommended_action) || !decision.reason_ja) throw new Error('invalid triage decision');
    for (const key of ['url','raw_path','title','source']) decision[key] = candidates.get(decision.item_id)![key] ?? null;
  }
  if (seen.size !== candidates.size) throw new Error('triage omitted candidates');
}
export function completeBacklog(cfg: Config, result: JsonObject, source: JsonObject): void {
  if (!source.collect_run_id || result.collect_run_id !== source.collect_run_id) throw new Error('backlog result does not match the input batch');
  const expected = new Map<string, JsonObject>(source.articles.map((a: JsonObject) => [a.filename, a]));
  if (!Array.isArray(result.completed)) throw new Error('backlog result requires completed array');
  const seen = new Set<string>();
  for (const item of result.completed) {
    if (!object(item) || !expected.has(item.filename) || seen.has(item.filename) || !['done','skipped'].includes(item.status) || !item.reason_ja) throw new Error('invalid backlog completion receipt');
    seen.add(item.filename);
  }
  if (seen.size !== expected.size) throw new Error('backlog batch has unfinished articles');
  const path = join(cfg.state, 'processed_raw_articles.json');
  const tracking = existsSync(path) ? readJson(path) : {};
  for (const item of result.completed) tracking[item.filename] = {...item, processed_at: new Date().toISOString(), url: expected.get(item.filename)?.url};
  writeJson(path, tracking);
}
export function wakeAgent(output: string): boolean {
  try { return JSON.parse(output).wakeAgent !== false; } catch {
    try { return JSON.parse(output.trim().split('\n').at(-1) ?? '').wakeAgent !== false; } catch { return true; }
  }
}
