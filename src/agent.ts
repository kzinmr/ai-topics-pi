/** SDK worker boundary: IPC carries our typed result, never Pi CLI output. */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import { killGroup, trackChild } from './process.js';
import type { AgentRequest, AgentResult, Job, PiSettings, WorkerReply } from './types.js';

export function agentRequest(cfg: Config, job?: Job): AgentRequest {
  return {source: cfg.source, profile: cfg.profile, repo: cfg.repo, state: cfg.state,
    pi: {...cfg.local.pi, ...job?.pi}, mode: 'prompt'};
}
export function runWorker(cfg: Config, request: AgentRequest, timeout: number): Promise<AgentResult | unknown[] | null> {
  return new Promise((resolve, reject) => {
    const interactive = request.mode === 'interactive';
    const child = fork(fileURLToPath(new URL('./agent-worker.js', import.meta.url)), [], {
      cwd: cfg.repo, env: cfg.env(), detached: true, execArgv: [],
      stdio: interactive ? ['inherit', 'inherit', 'inherit', 'ipc'] : ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const untrack = trackChild(child);
    let reply: WorkerReply | undefined, stderr = '', timedOut = false;
    let force: NodeJS.Timeout | undefined;
    const timer = Number.isFinite(timeout) ? setTimeout(() => {
      timedOut = true;
      if (child.connected) child.send({type: 'abort'});
      killGroup(child, 'SIGTERM');
      force = setTimeout(() => killGroup(child, 'SIGKILL'), 2000);
    }, timeout * 1000) : undefined;
    child.stdout?.resume(); // Extension output is not the result protocol.
    child.stderr?.setEncoding('utf8').on('data', data => { stderr = (stderr + data).slice(-8000); });
    child.on('message', message => { reply = message as WorkerReply; });
    const cleanup = (): void => { if (timer) clearTimeout(timer); if (force) clearTimeout(force); untrack(); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('exit', () => killGroup(child, 'SIGKILL'));
    child.on('close', code => {
      cleanup();
      if (timedOut) reject(new Error('Pi SDK session timed out'));
      else if (reply?.ok === false) reject(new Error(reply.error));
      // InteractiveMode disposes its runtime and exits the worker itself.
      else if (interactive && code === 0 && !reply) resolve(null);
      else if (code !== 0 || !reply) reject(new Error(`Pi SDK worker exited ${code}: ${stderr}`));
      else resolve(reply.result);
    });
    child.send({type: 'start', request});
  });
}
export async function runAgent(cfg: Config, prompt: string, timeout: number, job?: Job): Promise<AgentResult> {
  return await runWorker(cfg, {...agentRequest(cfg, job), prompt}, timeout) as AgentResult;
}
export async function listModels(cfg: Config, pi?: PiSettings): Promise<unknown[]> {
  return await runWorker(cfg, {...agentRequest(cfg), mode: 'models', pi: pi ?? cfg.local.pi ?? {}}, 60) as unknown[];
}
