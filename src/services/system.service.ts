import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export class SystemService {
  private baseDir: string;
  private logsDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".mr-rocket");
    this.logsDir = join(this.baseDir, "logs");
  }

  async appendCommandLog(entry: string): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
    const line = `${new Date().toISOString()} ${entry}\n`;
    const filePath = join(this.logsDir, "commands.log");
    await appendFile(filePath, line, "utf-8");
  }
}
