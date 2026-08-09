import { spawn } from "node:child_process";
import { basename, extname, join } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { configManager } from "../core/config-manager";
import { logger } from "../core/logger";
import type {
  AgentConfig,
  AgentOutputStream,
  AgentResult,
  HttpAgentConfig,
  ProcessAgentConfig,
} from "../types/agent";
import { Spinner } from "../utils/spinner";

export interface RunOptions {
  agentName?: string;
  repo?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  referenceImages?: string[];
  artifactDir?: string;
  silent?: boolean;
  onOutput?: (chunk: string, stream: AgentOutputStream) => void;
}

type RemoteArtifact = {
  name?: string;
  mimeType?: string;
  data?: string;
  url?: string;
};

const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REMOTE_ARTIFACT_BYTES = 25 * 1024 * 1024;

function abortError(): Error {
  return Object.assign(new Error("Agent run cancelled"), {
    name: "AbortError",
  });
}

function imageMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

export class AgentService {
  private getEnabledAgent(): [string, AgentConfig] | undefined {
    const agents = configManager.getConfig().agents || {};
    return Object.entries(agents).find(([, config]) => config.enabled);
  }

  async run(prompt: string, options: RunOptions = {}): Promise<AgentResult> {
    const agents = configManager.getConfig().agents || {};
    let name = options.agentName;
    let agentConfig = name ? agents[name] : undefined;

    if (!name) {
      const enabled = this.getEnabledAgent();
      if (enabled) [name, agentConfig] = enabled;
    }

    if (!name || !agentConfig) {
      throw new Error(
        options.agentName
          ? `Agent is not configured: ${options.agentName}`
          : "No agent enabled. Set enabled: true on an agent in ~/.mr-rocket/config.json",
      );
    }

    if (options.signal?.aborted) throw abortError();
    return agentConfig.transport === "http"
      ? this.runHttp(name, agentConfig, prompt, options)
      : this.runProcess(name, agentConfig, prompt, options);
  }

  async runMultiple(
    prompt: string,
    agentNames: string[],
    options: Omit<RunOptions, "agentName"> = {},
  ): Promise<AgentResult[]> {
    return Promise.all(
      agentNames.map((agentName) =>
        this.run(prompt, { ...options, agentName }),
      ),
    );
  }

  isEnabled(agentName?: string): boolean {
    if (agentName) {
      return configManager.getConfig().agents?.[agentName]?.enabled === true;
    }
    return this.getEnabledAgent() !== undefined;
  }

  private runProcess(
    name: string,
    config: ProcessAgentConfig,
    prompt: string,
    options: RunOptions,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const configuredArgs = [
      ...(config.subcommand ? [config.subcommand] : []),
      ...(config.args || []),
    ];
    const args = [...configuredArgs, ...(config.promptStdin ? [] : [prompt])];
    const spinner = options.silent ? undefined : new Spinner();
    const timeoutMs =
      options.timeoutMs ?? config.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      spinner?.start(`Running ${name}...`);
      logger.debug("Agent process starting", {
        agent: name,
        command: config.command,
        configuredArgs,
        cwd: options.repo || process.cwd(),
        promptStdin: config.promptStdin === true,
        timeoutMs,
      });

      const proc = spawn(config.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: options.repo,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const stop = () => {
        proc.kill("SIGTERM");
        killTimer = setTimeout(() => proc.kill("SIGKILL"), 5000);
      };
      const onAbort = () => stop();
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const timeout = setTimeout(() => {
        timedOut = true;
        logger.debug("Agent process timed out", {
          agent: name,
          duration: Date.now() - startTime,
          timeoutMs,
        });
        stop();
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", onAbort);
        spinner?.stop();
      };

      proc.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;
        options.onOutput?.(chunk, "stdout");
      });
      proc.stderr.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
        options.onOutput?.(chunk, "stderr");
      });
      proc.stdin.on("error", () => {});
      proc.stdin.end(config.promptStdin ? prompt : undefined);

      proc.on("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        logger.debug("Agent process failed to start", {
          agent: name,
          error: error.message,
          duration: Date.now() - startTime,
        });
        reject(new Error(`Failed to spawn ${name}: ${error.message}`));
      });

      proc.on("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (options.signal?.aborted) {
          reject(abortError());
          return;
        }
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
          stdout,
          stderr,
          exitCode,
          duration,
        });
      });
    });
  }

  private async runHttp(
    name: string,
    config: HttpAgentConfig,
    prompt: string,
    options: RunOptions,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutMs =
      options.timeoutMs ?? config.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const attachments = await Promise.all(
        (options.referenceImages || []).map(async (path) => {
          if ((await stat(path)).size > MAX_REMOTE_ARTIFACT_BYTES) {
            throw new Error(`Reference image ${basename(path)} exceeds 25 MB`);
          }
          return {
            name: basename(path),
            mimeType: imageMimeType(path),
            data: (await readFile(path)).toString("base64"),
          };
        }),
      );
      const response = await fetch(config.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...config.headers },
        body: JSON.stringify({ prompt, attachments }),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(
          `Remote agent ${name} returned ${response.status}: ${raw.slice(0, 1000)}`,
        );
      }

      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("json") ? JSON.parse(raw) : raw;
      const output =
        typeof data === "string"
          ? data
          : typeof data?.output === "string"
            ? data.output
            : JSON.stringify(data);
      const artifacts =
        options.artifactDir && Array.isArray(data?.artifacts)
          ? await this.saveRemoteArtifacts(
              data.artifacts,
              options.artifactDir,
              controller.signal,
            )
          : undefined;
      options.onOutput?.(output, "stdout");
      return {
        agent: name,
        output,
        stdout: output,
        stderr: "",
        artifacts,
        exitCode: 0,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (controller.signal.aborted) {
        throw new Error(`${name} timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async saveRemoteArtifacts(
    artifacts: RemoteArtifact[],
    outputDir: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });
    return Promise.all(
      artifacts.map(async (artifact, index) => {
        const name = basename(artifact.name || `image-${index + 1}.png`);
        const path = join(outputDir, name);
        let bytes: Buffer;
        if (artifact.data) {
          bytes = Buffer.from(
            artifact.data.replace(/^data:[^,]+,/, ""),
            "base64",
          );
        } else if (artifact.url) {
          const response = await fetch(artifact.url, { signal });
          if (!response.ok)
            throw new Error(`Could not download artifact: ${response.status}`);
          bytes = Buffer.from(await response.arrayBuffer());
        } else {
          throw new Error(`Remote artifact ${name} has no data or url`);
        }
        if (bytes.byteLength > MAX_REMOTE_ARTIFACT_BYTES) {
          throw new Error(`Remote artifact ${name} exceeds 25 MB`);
        }
        if (bytes.byteLength === 0)
          throw new Error(`Remote artifact ${name} is empty`);
        await writeFile(path, bytes);
        return path;
      }),
    );
  }

  getAvailableAgents(): string[] {
    return Object.keys(configManager.getConfig().agents || {});
  }
}

export const agentService = new AgentService();
