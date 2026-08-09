interface AgentConfigBase {
  enabled?: boolean;
  /** Maximum agent runtime in milliseconds. Defaults to 10 minutes. */
  timeoutMs?: number;
}

export interface ProcessAgentConfig extends AgentConfigBase {
  transport?: "process";
  command: string;
  args?: string[];
  subcommand?: string;
  /**
   * Send the prompt on stdin instead of appending it as the final argument.
   * Default is false, matching commands like `codex exec <prompt>`.
   */
  promptStdin?: boolean;
}

export interface HttpAgentConfig extends AgentConfigBase {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type AgentConfig = ProcessAgentConfig | HttpAgentConfig;
export type AgentOutputStream = "stdout" | "stderr";

export interface AgentsConfig {
  agents?: Record<string, AgentConfig>;
}

export interface AgentResult {
  agent: string;
  output: string;
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
  duration: number;
  artifacts?: string[];
}
