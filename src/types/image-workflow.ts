import type { AgentOutputStream } from "./agent";

export type ImageWorkflowPhase =
  | "understanding"
  | "generating"
  | "verifying"
  | "refining"
  | "completed"
  | "cancelled"
  | "failed";

export interface ImageGenerationConfig {
  mainAgent: string;
  drawAgent: string;
  maxIterations?: number;
  outputDir?: string;
}

export interface ImageWorkflowInput {
  prompt: string;
  referenceImages?: string[];
  outputDir?: string;
}

export interface ImageWorkflowEvent {
  phase: ImageWorkflowPhase;
  message: string;
  iteration?: number;
  timestamp: number;
}

export interface ImageWorkflowLog {
  agent: string;
  stream: AgentOutputStream;
  text: string;
  timestamp: number;
}

export interface ImageWorkflowResult {
  images: string[];
  refinedPrompt: string;
  checks: string[];
  iterations: number;
  events: ImageWorkflowEvent[];
}
