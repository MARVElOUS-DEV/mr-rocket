import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { AgentConfig, ProcessAgentConfig } from "../types/agent";
import type { AppConfig } from "../types/config";
import {
  MAX_IMAGE_MAX_DURATION_MS,
  MAX_IMAGE_MAX_ITERATIONS,
  MIN_IMAGE_MAX_DURATION_MS,
  MIN_IMAGE_MAX_ITERATIONS,
} from "../types/image-workflow";
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
    const agents = this.mergeAgents(config.agents, defaults.agents);

    const imageGeneration = {
      ...defaults.imageGeneration!,
      ...config.imageGeneration,
    };

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
        ...agents,
      },
      imageGeneration,
      ui: {
        ...defaults.ui,
        ...config.ui,
      },
    };
  }

  private mergeAgents(
    configured: AppConfig["agents"],
    defaults: AppConfig["agents"],
  ): Record<string, AgentConfig> {
    const agents: Record<string, AgentConfig> = {
      ...(defaults || {}),
      ...(configured || {}),
    };
    for (const [name, defaultAgent] of Object.entries(defaults || {})) {
      const configuredAgent = configured?.[name];
      if (!configuredAgent) continue;
      if (
        defaultAgent.transport === "http" ||
        configuredAgent.transport === "http"
      ) {
        agents[name] = { ...defaultAgent, ...configuredAgent } as AgentConfig;
        continue;
      }
      const defaultProcess = defaultAgent as ProcessAgentConfig;
      const configuredProcess = configuredAgent as ProcessAgentConfig;
      const defaultOutput = defaultProcess.capabilities?.output;
      const configuredOutput = configuredProcess.capabilities?.output;
      const output = configuredOutput
        ? defaultOutput?.protocol === configuredOutput.protocol
          ? { ...defaultOutput, ...configuredOutput }
          : configuredOutput
        : defaultOutput;
      agents[name] = {
        ...defaultProcess,
        ...configuredProcess,
        capabilities: {
          ...defaultProcess.capabilities,
          ...configuredProcess.capabilities,
          output,
        },
      } as ProcessAgentConfig;
    }
    return agents;
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
        workflow.maxIterations < MIN_IMAGE_MAX_ITERATIONS ||
        workflow.maxIterations > MAX_IMAGE_MAX_ITERATIONS)
    ) {
      throw new Error(
        `imageGeneration.maxIterations must be an integer from ${MIN_IMAGE_MAX_ITERATIONS} to ${MAX_IMAGE_MAX_ITERATIONS}`,
      );
    }
    if (
      workflow?.maxDurationMs !== undefined &&
      (!Number.isFinite(workflow.maxDurationMs) ||
        workflow.maxDurationMs < MIN_IMAGE_MAX_DURATION_MS ||
        workflow.maxDurationMs > MAX_IMAGE_MAX_DURATION_MS)
    ) {
      throw new Error(
        `imageGeneration.maxDurationMs must be from ${MIN_IMAGE_MAX_DURATION_MS} to ${MAX_IMAGE_MAX_DURATION_MS}`,
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
      } else {
        const capabilities = agent.capabilities;
        if (
          capabilities?.workspaceArg !== undefined &&
          !capabilities.workspaceArg.trim()
        ) {
          throw new Error(`Agent ${name} workspaceArg cannot be empty`);
        }
        if (
          capabilities?.output?.protocol !== undefined &&
          capabilities.output.protocol !== "text" &&
          capabilities.output.protocol !== "json-lines"
        ) {
          throw new Error(`Agent ${name} has an invalid output protocol`);
        }
        if (
          capabilities?.output?.protocol === "json-lines" &&
          (capabilities.output.resultEventType === "" ||
            capabilities.output.resultField === "")
        ) {
          throw new Error(
            `Agent ${name} JSON-lines result selectors cannot be empty`,
          );
        }
        for (const [field, args] of [
          ["nonInteractiveArgs", capabilities?.nonInteractiveArgs],
          ["resumeArgs", capabilities?.resumeArgs],
          ["output.args", capabilities?.output?.args],
        ] as const) {
          if (args?.some((arg) => !arg.trim())) {
            throw new Error(`Agent ${name} ${field} cannot contain empty args`);
          }
        }
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
