import { spawn } from "node:child_process";
import { configManager } from "../core/config-manager";
import { logger } from "../core/logger";
import type { AgentConfig, AgentResult } from "../types/agent";
import { Spinner } from "../utils/spinner";

export interface RunOptions {
  agentName?: string;
  repo?: string;
  timeoutMs?: number;
}

const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;

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

    return this.spawn(name, agentConfig, prompt, {
      repo: options?.repo,
      timeoutMs: options?.timeoutMs,
    });
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
    options?: Pick<RunOptions, "repo" | "timeoutMs">,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const configuredArgs = [
      ...(config.subcommand ? [config.subcommand] : []),
      ...(config.args || []),
    ];
    const args = [
      ...configuredArgs,
      ...(config.promptStdin ? [] : [prompt]),
    ];
    const spinner = new Spinner();
    const timeoutMs =
      options?.timeoutMs ?? config.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      spinner.start(`Running ${name}...`);
      logger.debug("Agent process starting", {
        agent: name,
        command: config.command,
        configuredArgs,
        cwd: options?.repo || process.cwd(),
        promptStdin: config.promptStdin === true,
        timeoutMs,
      });

      const proc = spawn(config.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: options?.repo,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killTimer: Timer | undefined;

      const timeout = setTimeout(() => {
        timedOut = true;
        logger.debug("Agent process timed out", {
          agent: name,
          duration: Date.now() - startTime,
          timeoutMs,
        });
        proc.kill("SIGTERM");
        killTimer = setTimeout(() => {
          proc.kill("SIGKILL");
        }, 5000);
      }, timeoutMs);

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));
      proc.stdin.on("error", () => {
        // The child may close stdin immediately; there is nothing to recover.
      });

      if (config.promptStdin) {
        proc.stdin.end(prompt);
      } else {
        proc.stdin.end();
      }

      proc.on("error", (err) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        spinner.stop();
        logger.debug("Agent process failed to start", {
          agent: name,
          error: err.message,
          duration: Date.now() - startTime,
        });
        reject(new Error(`Failed to spawn ${name}: ${err.message}`));
      });

      proc.on("close", (exitCode, signal) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        spinner.stop();
        const duration = Date.now() - startTime;
        logger.debug("Agent process finished", {
          agent: name,
          exitCode,
          signal,
          timedOut,
          duration,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });
        resolve({
          agent: name,
          output: timedOut
            ? `${name} timed out after ${timeoutMs}ms`
            : stdout || stderr,
          exitCode,
          duration,
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
