import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { HistoryEntry, HistoryFilter } from "../types/history.js";
import type { CommandOutput } from "../types/command-output.js";
import { error } from "../utils/colors.js";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG } from "../types/config.js";

const CONFIG_DIR = join(homedir(), ".mr-rocket");
const HISTORY_FILE = join(CONFIG_DIR, "history.json");

export class HistoryManager {
  private history: HistoryEntry[] = [];

  private getEntryTimestampMs(entry: HistoryEntry): number {
    if (typeof entry.timestampMs === "number") {
      return entry.timestampMs;
    }
    const parsed = Date.parse(entry.timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  async load(): Promise<HistoryEntry[]> {
    if (!existsSync(HISTORY_FILE)) {
      this.history = [];
      return this.history;
    }

    try {
      const content = await readFile(HISTORY_FILE, "utf-8");
      this.history = JSON.parse(content);
      return this.history;
    } catch (err) {
      console.error(error("Failed to load history file"));
      this.history = [];
      return this.history;
    }
  }

  async record(
    command: string,
    args: Record<string, unknown>,
    output: CommandOutput,
    duration: number
  ): Promise<void> {
    if (this.history.length === 0) {
      await this.load();
    }

    const entry: HistoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toLocaleString(),
      timestampMs: Date.now(),
      command,
      args,
      output,
      duration,
      status: output.success ? "success" : "error",
    };

    this.history.unshift(entry);

    if (this.history.length > DEFAULT_CONFIG.ui.maxHistoryItems) {
      this.history = this.history.slice(0, DEFAULT_CONFIG.ui.maxHistoryItems);
    }

    await this.save();
  }

  async save(): Promise<void> {
    try {
      if (!existsSync(CONFIG_DIR)) {
        await mkdir(CONFIG_DIR, { recursive: true });
      }
      await writeFile(HISTORY_FILE, JSON.stringify(this.history, null, 2), "utf-8");
    } catch (err) {
      console.error(error("Failed to save history file"));
      throw err;
    }
  }

  async query(filter?: HistoryFilter): Promise<HistoryEntry[]> {
    if (this.history.length === 0) {
      await this.load();
    }

    let results = [...this.history];

    if (filter?.command) {
      results = results.filter((e) => e.command.includes(filter.command!));
    }

    if (filter?.status) {
      results = results.filter((e) => e.status === filter.status);
    }

    if (filter?.startDate) {
      results = results.filter((e) => this.getEntryTimestampMs(e) >= filter.startDate!.getTime());
    }

    if (filter?.endDate) {
      results = results.filter((e) => this.getEntryTimestampMs(e) <= filter.endDate!.getTime());
    }

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async getById(id: string): Promise<HistoryEntry | undefined> {
    if (this.history.length === 0) {
      await this.load();
    }

    return this.history.find((e) => e.id === id);
  }
}

export const historyManager = new HistoryManager();
