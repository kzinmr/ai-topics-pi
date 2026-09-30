import { createRuntime, makeModelRuntime, promptSession } from './agent-session.js';
import { InteractiveMode } from '@earendil-works/pi-coding-agent';
import { errorText } from './files.js';
import type { AgentRequest, WorkerReply } from './types.js';

let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
let started = false;
let cancelled = false;
async function abort(): Promise<void> {
  cancelled = true;
  if (runtime) await runtime.session.abort();
}
process.on('SIGTERM', () => { void abort(); });
process.on('SIGINT', () => { void abort(); });
process.on('disconnect', () => { void abort().finally(() => process.exit(1)); });
async function finish(reply: WorkerReply): Promise<void> {
  await runtime?.dispose();
  if (process.send) process.send(reply, () => process.exit(reply.ok ? 0 : 1));
  else process.exit(1);
}
process.on('message', (message: {type: string; request?: AgentRequest}) => {
  if (message.type === 'abort') { void abort(); return; }
  if (message.type !== 'start' || started || !message.request) return;
  started = true;
  const request = message.request;
  void (async () => {
    if (request.mode === 'models') {
      const models = await (await makeModelRuntime(request)).getAvailable();
      return models.map(m => ({provider: m.provider, id: m.id, contextWindow: m.contextWindow}));
    }
    runtime = await createRuntime(request);
    if (cancelled) throw new Error('session aborted during setup');
    if (request.mode === 'interactive') { await new InteractiveMode(runtime).run(); return null; }
    if (!request.prompt) throw new Error('prompt is required');
    return await promptSession(runtime.session, request.prompt);
  })().then(result => finish({ok: true, result}), error => finish({ok: false, error: errorText(error)}))
    .catch(error => { console.error(errorText(error)); process.exit(1); });
});
