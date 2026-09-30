export type JsonObject = Record<string, any>;
export interface PiSettings {
  provider?: string;
  model?: string;
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  extensions?: string[];
}
export interface Job {
  name: string;
  enabled: boolean;
  schedule: string;
  script: string | null;
  no_agent: boolean;
  skills: string[];
  prompt: string;
  depends_on: string[];
  max_dependency_age_hours: number;
  timeout_seconds: number;
  script_timeout_seconds: number;
  response_format: 'text' | 'json';
  delivery: string;
  pi?: PiSettings;
}
export interface Route { kind: 'outbox' | 'command'; command?: string[]; timeout_seconds?: number }
export interface LocalConfig {
  pi?: PiSettings;
  python?: string;
  max_catchup_minutes?: number;
  publish?: boolean;
  environment?: Record<string, string>;
  delivery?: Record<string, Route>;
}
export interface AgentResult { text: string; usage: unknown[]; sessionFile?: string; sessionId?: string }
export interface AgentRequest {
  source: string; profile: string; repo: string; state: string;
  pi: PiSettings; prompt?: string; mode: 'prompt' | 'models' | 'interactive';
}
export type WorkerReply = { ok: true; result: AgentResult | unknown[] | null } | { ok: false; error: string };
export interface RunRow {
  id: string; job: string; started: string; finished: string | null;
  status: string; detail: string;
}
