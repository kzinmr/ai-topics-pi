import type { Config } from './config.js';
import { execute } from './process.js';
export async function publish(cfg: Config): Promise<{commit: string; pushed: boolean}> {
  const git = async (...args: string[]): Promise<string> => (await execute(['git', ...args], {cwd: cfg.repo, env: cfg.env(), timeout: 120})).trim();
  if (await git('diff', '--cached', '--name-only')) throw new Error('index is already staged; review and publish manually');
  if (await git('status', '--porcelain', '--', 'wiki')) {
    await git('add', '--', 'wiki');
    await git('commit', '-m', 'wiki: update collected knowledge');
  }
  await git('push');
  return {commit: await git('rev-parse', 'HEAD'), pushed: true};
}
