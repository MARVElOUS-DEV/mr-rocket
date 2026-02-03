import { spawn } from "node:child_process";
import { configManager } from "../core/config-manager";
import type { AgentConfig, AgentResult } from "../types/agent";

export interface RunOptions {
  agentName?: string;
  cwd?: string;
}

export class AgentService {
  private getEnabledAgent(): [string, AgentConfig] | undefined {
    const agents = configManager.getConfig().agents || {};
    for (const [name, config] of Object.entries(agents)) {
      if (config.enabled) return [name, config];
    }
    return undefined;
  }

  async run(prompt: string, options?: RunOptions): Promise<AgentResult> {
    const agents = configManager.getConfig().agents || {};
    let name = options?.agentName;
    let agentConfig: AgentConfig | undefined;

    if (name) {
      agentConfig = agents[name];
    } else {
      const enabled = this.getEnabledAgent();
      if (enabled) [name, agentConfig] = enabled;
    }

    if (!name || !agentConfig) {
      throw new Error(
        "No agent enabled. Set enabled: true on an agent in ~/.mr-rocket/config.json",
      );
    }

    return this.spawn(name, agentConfig, prompt, options?.cwd);
  }

  async runMultiple(
    prompt: string,
    agentNames: string[],
  ): Promise<AgentResult[]> {
    return Promise.all(
      agentNames.map((name) => this.run(prompt, { agentName: name })),
    );
  }

  isEnabled(agentName?: string): boolean {
    if (agentName) {
      return configManager.getConfig().agents?.[agentName]?.enabled === true;
    }
    return this.getEnabledAgent() !== undefined;
  }

  private spawn(
    name: string,
    config: AgentConfig,
    prompt: string,
    cwd?: string,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const args = [
      ...(config.subcommand ? [config.subcommand] : []),
      ...(config.args || []),
      prompt,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(config.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("error", (err) =>
        reject(new Error(`Failed to spawn ${name}: ${err.message}`)),
      );

      proc.on("close", (exitCode) => {
        resolve({
          agent: name,
          output: stdout || stderr,
          exitCode,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  getAvailableAgents(): string[] {
    const config = configManager.getConfig();
    return Object.keys(config.agents || {});
  }
}

export const agentService = new AgentService();
