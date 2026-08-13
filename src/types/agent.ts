interface AgentConfigBase {
  enabled?: boolean;
  /** Maximum agent runtime in milliseconds. Defaults to 10 minutes. */
  timeoutMs?: number;
}

export interface JsonLinesOutputConfig {
  protocol: "json-lines";
  /** Arguments that enable this output protocol. */
  args?: string[];
  /** Event discriminator and result field. Defaults to "result" for both. */
  resultEventType?: string;
  resultField?: string;
}

export interface TextOutputConfig {
  protocol: "text";
  args?: string[];
}

export interface ProcessAgentCapabilities {
  /** Arguments required for unattended execution, appended after normal args. */
  nonInteractiveArgs?: string[];
  /** CLI option placed before the working-directory path. */
  workspaceArg?: string;
  /** Arguments used to resume the latest session in the workspace. */
  resumeArgs?: string[];
  /** Whether prompts may reference readable local image paths. Defaults to true. */
  localImagePaths?: boolean;
  output?: JsonLinesOutputConfig | TextOutputConfig;
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
  capabilities?: ProcessAgentCapabilities;
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
  timedOut?: boolean;
  artifacts?: string[];
}
