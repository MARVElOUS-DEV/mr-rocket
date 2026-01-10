import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { AppConfig } from "../models/config.js";
import { error, success } from "./colors";

const CONFIG_DIR = join(homedir(), ".mr-rocket");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export class ConfigManager {
  private config: AppConfig | null = null;

  async load(): Promise<AppConfig> {
    if (this.config) {
      return this.config;
    }

    if (!existsSync(CONFIG_FILE)) {
      await this.createDefaultConfig();
    }

    try {
      const content = await readFile(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(content) as AppConfig;
      const { DEFAULT_CONFIG } = await import("../models/config.js");
      const merged = this.mergeConfig(parsed, DEFAULT_CONFIG);
      this.config = merged;
      this.validateConfig(this.config);
      if (JSON.stringify(parsed) !== JSON.stringify(merged)) {
        await this.save(merged);
      }
      return this.config;
    } catch (err) {
      console.error(error("Failed to load config file"));
      throw err;
    }
  }

  private mergeConfig(config: AppConfig, defaults: AppConfig): AppConfig {
    return {
      ...defaults,
      ...config,
      gitlab: {
        ...defaults.gitlab,
        ...config.gitlab,
        tls: {
          ...defaults.gitlab.tls,
          ...config.gitlab?.tls,
        },
      },
      confluence: {
        ...defaults.confluence,
        ...config.confluence,
        tls: {
          ...defaults.confluence.tls,
          ...config.confluence?.tls,
        },
      },
      ui: {
        ...defaults.ui,
        ...config.ui,
      },
    };
  }

  private validateConfig(config: AppConfig): void {
    if (!config.version) {
      throw new Error("Config version is missing");
    }
    if (!config.gitlab) {
      throw new Error("GitLab config section is missing");
    }
    if (!config.gitlab.host) {
      throw new Error("GitLab host is required");
    }
    if (!config.gitlab.token || config.gitlab.token === "YOUR_PERSONAL_ACCESS_TOKEN_HERE") {
      throw new Error("GitLab token is not configured. Please edit ~/.mr-rocket/config.json");
    }
  }

  async save(config: AppConfig): Promise<void> {
    try {
      await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
      this.config = config;
    } catch (err) {
      console.error(error("Failed to save config file"));
      throw err;
    }
  }

  private async createDefaultConfig(): Promise<void> {
    const { DEFAULT_CONFIG } = await import("../models/config.js");

    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }

    await this.save(DEFAULT_CONFIG);
    console.log(success(`Created default config at ${CONFIG_FILE}`));
    console.log(`Please edit ${CONFIG_FILE} and add your GitLab token.`);
  }

  getConfigPath(): string {
    return CONFIG_FILE;
  }

  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error("Config not loaded. Call load() first.");
    }
    return this.config;
  }
}

export const configManager = new ConfigManager();
