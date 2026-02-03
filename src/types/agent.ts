export interface AgentConfig {
  command: string;
  args?: string[];
  subcommand?: string;
  enabled?: boolean;
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
