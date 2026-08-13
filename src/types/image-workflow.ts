import type { AgentOutputStream } from "./agent";

export const DEFAULT_IMAGE_MAX_ITERATIONS = 3;
export const MIN_IMAGE_MAX_ITERATIONS = 1;
export const MAX_IMAGE_MAX_ITERATIONS = 30;
export const DEFAULT_IMAGE_MAX_DURATION_MS = 20 * 60 * 1000;
export const MIN_IMAGE_MAX_DURATION_MS = 60 * 1000;
export const MAX_IMAGE_MAX_DURATION_MS = 60 * 60 * 1000;

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
  /** Maximum wall-clock runtime for the complete plan/draw/review workflow. */
  maxDurationMs?: number;
  outputDir?: string;
}

export interface ImageWorkflowInput {
  prompt: string;
  referenceImages?: string[];
  outputDir?: string;
  /** Per-run override; the configured value is used when omitted. */
  maxIterations?: number;
  /** Per-run wall-clock override in milliseconds. */
  maxDurationMs?: number;
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
  verified: boolean;
  feedback: string[];
  events: ImageWorkflowEvent[];
}
