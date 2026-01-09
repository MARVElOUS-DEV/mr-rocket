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

export interface CommandOutput {
  success: boolean;
  data?: unknown;
  error?: Error;
  message?: string;
  meta?: Record<string, unknown>;
}
