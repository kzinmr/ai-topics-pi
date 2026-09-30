/** Runs inside the OS sandbox, with no model or publication credentials. */
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import {
  createReadTool, createWriteTool, createEditTool, createBashTool,
  createGrepTool, createFindTool, createLsTool, createLocalBashOperations,
} from '@earendil-works/pi-coding-agent';

const factories = {read: createReadTool, write: createWriteTool, edit: createEditTool,
  bash: createBashTool, grep: createGrepTool, find: createFindTool, ls: createLsTool};
try {
  const {name, params, cwd} = JSON.parse(readFileSync(0, 'utf8'));
  if (name === '$probe') console.log(JSON.stringify({result: {sandbox: 'bubblewrap'}}));
  else if (name === '$audit') {
    const result: Record<string, boolean> = {};
    for (const key of ['control', 'auth', 'link']) {
      try { readFileSync(params[key]); result[`${key}_read_denied`] = false; }
      catch { result[`${key}_read_denied`] = true; }
    }
    for (const key of ['control', 'auth', 'script', 'raw']) {
      try {
        // Test write access without changing installed code, even if isolation regresses.
        if (key === 'script') closeSync(openSync(params[key], 'r+'));
        else writeFileSync(params[key], 'changed');
        result[`${key}_write_denied`] = false;
      }
      catch { result[`${key}_write_denied`] = true; }
    }
    for (const key of ['wiki', 'scratch']) {
      writeFileSync(params[key], 'allowed'); result[`${key}_write_allowed`] = readFileSync(params[key], 'utf8') === 'allowed';
    }
    result.raw_read_allowed = readFileSync(params.raw, 'utf8') === 'synthetic canary';
    result.network_denied = await new Promise<boolean>(resolve => {
      const socket = createConnection({host: '127.0.0.1', port: params.port});
      const finish = (denied: boolean) => { socket.destroy(); resolve(denied); };
      socket.once('connect', () => finish(false)); socket.once('error', () => finish(true));
      socket.setTimeout(1000, () => finish(true));
    });
    result.credentials_absent = !Object.keys(process.env).some(key => /TOKEN|SECRET|API_KEY|PASSWORD/.test(key));
    console.log(JSON.stringify({result}));
  }
  else if (name === '$shell') {
    let output = '';
    const result = await createLocalBashOperations({shellPath: '/bin/bash'}).exec(params.command, cwd, {
      onData: data => { output = (output + data.toString()).slice(-100_000); }, timeout: params.timeout ?? 120,
    });
    console.log(JSON.stringify({result: {...result, output}}));
  }
  else {
    const factory = factories[name as keyof typeof factories];
    if (!factory) throw new Error(`Unsupported sandbox tool: ${name}`);
    const tool = factory(cwd);
    const result = await tool.execute('sandbox', params);
    console.log(JSON.stringify({result}));
  }
} catch (error) { console.log(JSON.stringify({error: String(error)})); }
