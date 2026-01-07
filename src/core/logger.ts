export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, meta ?? "");
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, meta ?? "");
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, meta ?? "");
    }
  }

  error(message: string, err?: unknown): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, err ?? "");
    }
  }
}

export const logger = new Logger();
