import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
  createBashToolDefinition, createGrepToolDefinition, createFindToolDefinition,
  createLsToolDefinition, createPowerShellToolDefinition,
  type ExtensionFactory, type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { AgentRequest } from './types.js';
import { networkAllowed, researchJobs, sandboxTool } from './sandbox.js';
import { search } from './search.js';

export function sandboxTools(request: AgentRequest): ToolDefinition[] {
  const tools = [createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
    createBashToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
    createPowerShellToolDefinition].map(factory => {
    const tool = factory(request.repo);
    return {...tool, execute: async (_id: string, params: any, signal?: AbortSignal) => {
      if (tool.name === 'powershell') throw new Error('PowerShell is not enabled in this Linux sandbox');
      return sandboxTool(request, tool.name, params, signal, Math.min(params.timeout ?? 120, 3600));
    }} as ToolDefinition;
  });
  // The broker keeps search credentials outside the shell environment.
  if (networkAllowed(request)) tools.push({
    name: 'web_search', label: 'Web search', description: 'Search public sources using the configured search service.',
    parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query'], additionalProperties: false} as any,
    async execute(_id, {query}) {
      if (typeof query !== 'string' || !query.trim() || query.length > 4000) throw new Error('Invalid search query');
      return {content: [{type: 'text', text: await search(query, process.env, request.repo)}], details: {}};
    },
  });
  // Raw is read-only even for research bash. A narrow broker only creates new evidence.
  if (request.job && researchJobs.includes(request.job)) tools.push({
    name: 'save_raw', label: 'Save new source', description: 'Create a new immutable ~/wiki/raw/articles/<filename>.md. Existing files cannot be replaced.',
    parameters: {type: 'object', properties: {filename: {type: 'string'}, content: {type: 'string'}}, required: ['filename', 'content'], additionalProperties: false} as any,
    async execute(_id, {filename, content}) {
      if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(filename) || filename.length > 200 ||
        typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Invalid raw article');
      const dir = join(request.repo, 'wiki/raw/articles');
      if (realpathSync(dir) !== dir) throw new Error('Raw directory cannot contain symlinks');
      writeFileSync(join(dir, filename), content, {flag: 'wx', mode: 0o600});
      return {content: [{type: 'text', text: `Saved ~/wiki/raw/articles/${filename}`}], details: {}};
    },
  });
  return tools;
}

/** Pi's !/!! commands must use the same boundary as model bash calls. */
export function sandboxExtension(request: AgentRequest): ExtensionFactory {
  return pi => {
    pi.on('user_bash', () => ({operations: {async exec(command, _cwd, options) {
      const result = await sandboxTool(request, '$shell', {command, timeout: options.timeout}, options.signal, options.timeout ?? 120);
      options.onData(Buffer.from(result.output));
      return {exitCode: result.exitCode};
    }}}));
  };
}
