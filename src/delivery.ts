import { join } from 'node:path';
import type { Config } from './config.js';
import { errorText, readJson, writeJson } from './files.js';
import { execute, postJson } from './process.js';
import type { Job } from './types.js';

export interface Envelope {
  version: number; run: string; job: string; route: string; text: string;
  status: 'pending' | 'failed' | 'delivered'; attempts: number; error?: string;
}
export function enqueue(cfg: Config, run: string, job: Job, text: string): string | undefined {
  if (!text.trim() || ['NO_MESSAGE', '[SILENT]'].includes(text.trim())) return;
  const path = join(cfg.state, 'outbox', `${run}.json`);
  writeJson(path, {version: 1, run, job: job.name, route: job.delivery, text, status: 'pending', attempts: 0});
  return path;
}
export async function deliver(cfg: Config, path: string): Promise<Envelope> {
  const item = readJson<Envelope>(path);
  const route = cfg.local.delivery?.[item.route];
  if (item.status === 'delivered' || !route || route.kind === 'outbox') return item;
  if (!Array.isArray(route.command) || !route.command.length || !route.command.every(x => typeof x === 'string')) throw new Error('delivery command must be an argv array');
  item.attempts++;
  try {
    await execute(route.command, {cwd: cfg.profile, env: cfg.env(), timeout: route.timeout_seconds ?? 60, input: JSON.stringify(item)});
    item.status = 'delivered'; delete item.error;
  } catch (error) { item.status = 'failed'; item.error = cfg.redact(errorText(error)); }
  writeJson(path, item);
  return item;
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]; if (!value) throw new Error(`missing ${name}`); return value;
}
export async function notify(item: Envelope, env: NodeJS.ProcessEnv): Promise<void> {
  const text = item.text + `\n[run:${item.run}]`;
  const telegram = item.route === 'digest';
  const size = telegram ? 4000 : 1900;
  for (let start = 0; start < text.length; start += size) {
    const chunk = text.slice(start, start + size);
    if (telegram) await postJson(`https://api.telegram.org/bot${required(env, 'TELEGRAM_BOT_TOKEN')}/sendMessage`, {chat_id: required(env, 'TELEGRAM_DIGEST_CHAT'), text: chunk});
    else await postJson(`https://discord.com/api/v10/channels/${required(env, item.route === 'hot-posts' ? 'DISCORD_HOT_POSTS_CHANNEL' : 'DISCORD_OPERATIONS_CHANNEL')}/messages`,
      {content: chunk, allowed_mentions: {parse: []}}, {Authorization: `Bot ${required(env, 'DISCORD_BOT_TOKEN')}`});
  }
}
