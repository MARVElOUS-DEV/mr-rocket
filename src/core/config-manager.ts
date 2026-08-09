import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { AppConfig } from "../types/config";
import { error, success } from "../utils/colors";

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
      const { DEFAULT_CONFIG } = await import("../types/config.js");
      const merged = this.mergeConfig(parsed, DEFAULT_CONFIG);
      this.config = merged;
      this.validateConfig(this.config);
      return this.config;
    } catch (err) {
      console.error(error("Failed to load config file"));
      throw err;
    }
  }

  private mergeConfig(config: AppConfig, defaults: AppConfig): AppConfig {
    const agy = {
      ...defaults.agents!.agy!,
      ...config.agents?.agy,
    };
    if (agy.transport !== "http") {
      agy.args = [...(agy.args || []).filter((arg) => arg !== "--print"), "--print"];
    }

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
      cdp: config.cdp
        ? {
            ...config.cdp,
            tls: {
              ...config.cdp.tls,
            },
          }
        : undefined,
      agents: {
        ...defaults.agents,
        ...config.agents,
        codex: {
          ...defaults.agents!.codex!,
          ...config.agents?.codex,
        },
        agy,
      },
      imageGeneration: {
        ...defaults.imageGeneration!,
        ...config.imageGeneration,
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
    if (config.cdp) {
      if (!config.cdp.host) {
        throw new Error("CDP host is required if CDP section is present");
      }
    }

    const workflow = config.imageGeneration;
    if (workflow && (!workflow.mainAgent || !workflow.drawAgent)) {
      throw new Error("Image generation requires mainAgent and drawAgent");
    }
    if (
      workflow?.maxIterations !== undefined &&
      (!Number.isInteger(workflow.maxIterations) ||
        workflow.maxIterations < 1 ||
        workflow.maxIterations > 100)
    ) {
      throw new Error(
        "imageGeneration.maxIterations must be an integer from 1 to 100",
      );
    }

    for (const [name, agent] of Object.entries(config.agents || {})) {
      if (
        agent.timeoutMs !== undefined &&
        (!Number.isFinite(agent.timeoutMs) || agent.timeoutMs <= 0)
      ) {
        throw new Error(`Agent ${name} timeoutMs must be positive`);
      }
      if (agent.transport === "http") {
        let url: URL;
        try {
          url = new URL(agent.url);
        } catch {
          throw new Error(`Agent ${name} has an invalid URL`);
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error(`Agent ${name} URL must use HTTP or HTTPS`);
        }
      } else if (!agent.command?.trim()) {
        throw new Error(`Agent ${name} command is required`);
      }
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
    const { DEFAULT_CONFIG } = await import("../types/config.js");

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
