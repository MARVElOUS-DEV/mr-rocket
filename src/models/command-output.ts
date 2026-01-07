export interface CommandOutput {
  success: boolean;
  data?: unknown;
  error?: Error;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface TableOutput {
  headers: string[];
  rows: string[][];
  summary?: string;
}
