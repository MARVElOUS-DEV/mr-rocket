import type { CommandOutput } from "./command-output.js";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  timestampMs?: number;
  command: string;
  args: Record<string, unknown>;
  output: CommandOutput;
  duration: number;
  status: "success" | "error";
}

export interface HistoryFilter {
  command?: string;
  status?: "success" | "error";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}
