import { execute } from './process.js';
export async function search(query: string, env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
  if (!query) throw new Error('usage: wiki-search QUERY');
  if (env.WIKI_SEARCH_COMMAND) {
    const argv: unknown = JSON.parse(env.WIKI_SEARCH_COMMAND);
    if (!Array.isArray(argv) || !argv.length || !argv.every(x => typeof x === 'string')) throw new Error('WIKI_SEARCH_COMMAND must be an argv array');
    return execute([...argv, query], {cwd, env, timeout: 60});
  }
  if (!env.BRAVE_API_KEY) throw new Error('configure BRAVE_API_KEY or WIKI_SEARCH_COMMAND');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.search = new URLSearchParams({q: query, count: '10'}).toString();
  const response = await fetch(url, {headers: {'X-Subscription-Token': env.BRAVE_API_KEY, Accept: 'application/json'}, signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`search HTTP ${response.status}`);
  return response.text();
}
