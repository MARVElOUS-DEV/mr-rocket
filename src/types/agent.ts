export interface AgentConfig {
  command: string;
  args?: string[];
  subcommand?: string;
  enabled?: boolean;
  /**
   * Send the prompt on stdin instead of appending it as the final argument.
   * Default is false, matching commands like `codex exec <prompt>`.
   */
  promptStdin?: boolean;
  /** Maximum agent runtime in milliseconds. Defaults to 10 minutes. */
  timeoutMs?: number;
}

export interface AgentsConfig {
  agents?: Record<string, AgentConfig>;
}

export interface AgentResult {
  agent: string;
  output: string;
  exitCode: number | null;
  duration: number;
}
