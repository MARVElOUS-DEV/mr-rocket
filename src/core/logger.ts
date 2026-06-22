import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_DIR = join(homedir(), ".mr-rocket", "logs");
const LOG_FILE = join(LOG_DIR, "app.log");

export class Logger {
  private level: LogLevel = LogLevel.INFO;
  private logToFile: boolean = true;

  constructor() {
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    try {
      mkdirSync(LOG_DIR, { recursive: true });
    } catch {
      process.stderr.write("");
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setLogToFile(enable: boolean): void {
    this.logToFile = enable;
  }

  private writeLog(level: string, message: string, meta?: unknown): void {
    const timestamp = new Date().toLocaleString();
    const metaStr = meta ? ` ${JSON.stringify(meta, null, 2)}` : "";
    const logEntry = `[${timestamp}] [${level}] ${message}${metaStr}\n`;

    if (this.logToFile) {
      try {
        this.ensureLogDir();
        appendFileSync(LOG_FILE, logEntry, "utf-8");
      } catch {
        process.stderr.write("");
      }
    }
  }

  debug(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.DEBUG) {
      const prefix = "\x1b[34m[DEBUG]\x1b[0m";
      console.debug(`${prefix} ${message}`, meta ?? "");
    }
    this.writeLog("DEBUG", message, meta);
  }

  info(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.INFO) {
      const prefix = "\x1b[32m[INFO]\x1b[0m";
      console.info(`${prefix} ${message}`, meta ?? "");
    }
    this.writeLog("INFO", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.WARN) {
      const prefix = "\x1b[33m[WARN]\x1b[0m";
      console.warn(`${prefix} ${message}`, meta ?? "");
    }
    this.writeLog("WARN", message, meta);
  }

  error(message: string, err?: unknown): void {
    if (this.level <= LogLevel.ERROR) {
      const prefix = "\x1b[31m[ERROR]\x1b[0m";
      console.error(`${prefix} ${message}`, err ?? "");
    }
    const errorMeta = err instanceof Error ? { message: err.message, stack: err.stack } : err;
    this.writeLog("ERROR", message, errorMeta);
  }
}

export const logger = new Logger();
