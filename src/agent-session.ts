/** All model, resource, tool and conversation behavior belongs to the Pi SDK. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createAgentSession, createAgentSessionRuntime, createAgentSessionServices,
  ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';
import type { AgentRequest, AgentResult } from './types.js';
import { checkSandbox } from './sandbox.js';
import { sandboxExtension, sandboxTools } from './sandbox-tools.js';

export async function makeModelRuntime(request: AgentRequest): Promise<ModelRuntime> {
  const agentDir = join(request.profile, '.pi/agent');
  const runtime = await ModelRuntime.create({authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'), allowModelNetwork: false});
  if (runtime.getError()) throw new Error(runtime.getError());
  return runtime;
}
export async function createRuntime(request: AgentRequest) {
  await checkSandbox(request);
  const agentDir = join(request.profile, '.pi/agent');
  const factory: CreateAgentSessionRuntimeFactory = async ({cwd, sessionManager, sessionStartEvent}) => {
    // Rebuilt on /new, /resume and /fork; profile credentials never change cwd.
    const modelRuntime = await makeModelRuntime(request);
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const services = await createAgentSessionServices({cwd, agentDir, modelRuntime, settingsManager,
      resourceLoaderOptions: {
        noContextFiles: true, noExtensions: true, noThemes: true,
        additionalExtensionPaths: (request.pi.extensions ?? []).map(p => resolve(request.source, p)),
        extensionFactories: [sandboxExtension(request)],
        additionalSkillPaths: [join(request.source, 'skills')],
        additionalPromptTemplatePaths: [join(request.source, 'prompts')],
        systemPromptOverride: () => undefined,
        appendSystemPromptOverride: () => [readFileSync(join(request.source, 'config/AGENTS.md'), 'utf8')],
      },
    });
    const errors = services.diagnostics.filter(d => d.type === 'error');
    if (errors.length) throw new Error(errors.map(d => d.message).join('\n'));
    let model;
    if (request.pi.provider || request.pi.model) {
      if (!request.pi.provider || !request.pi.model) throw new Error('set both pi.provider and pi.model');
      model = modelRuntime.getModel(request.pi.provider, request.pi.model);
      if (!model) throw new Error(`model not found: ${request.pi.provider}/${request.pi.model}`);
    }
    const created = await createAgentSession({cwd, agentDir, modelRuntime, settingsManager,
      resourceLoader: services.resourceLoader, sessionManager, sessionStartEvent,
      customTools: sandboxTools(request),
      model, thinkingLevel: request.pi.thinking});
    return {...created, services, diagnostics: services.diagnostics};
  };
  return createAgentSessionRuntime(factory, {cwd: request.repo, agentDir,
    sessionManager: SessionManager.create(request.repo, join(request.state, 'sessions'))});
}
export async function promptSession(session: AgentSession, prompt: string): Promise<AgentResult> {
  const usage: unknown[] = [];
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'message_end' && event.message.role === 'assistant') usage.push(event.message.usage);
  });
  try {
    await session.bindExtensions({mode: 'print'});
    // prompt resolves after retries/compaction/queued work settle. A transient
    // failed message is not final failure if Pi subsequently recovers.
    await session.prompt(prompt, {expandPromptTemplates: false});
    const last = session.messages.at(-1);
    if (!last || last.role !== 'assistant' || last.stopReason !== 'stop') {
      throw new Error(`Pi did not complete: ${last?.role === 'assistant' ? last.errorMessage || last.stopReason : 'missing final assistant message'}`);
    }
    const text = session.getLastAssistantText()?.trim();
    if (!text) throw new Error('Pi returned no final text');
    return {text, usage, sessionFile: session.sessionFile, sessionId: session.sessionId};
  } finally { unsubscribe(); }
}
