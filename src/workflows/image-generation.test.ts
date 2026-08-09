import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { configManager, ConfigManager } from "../core/config-manager";
import { DEFAULT_CONFIG, type AppConfig } from "../types/config";
import type { AgentResult } from "../types/agent";
import { AgentService, type RunOptions } from "../services/agent.service";
import { createImageWorkflowLog } from "../utils/image-workflow-log";
import { ImageGenerationWorkflow } from "./image-generation";

const originalGetConfig = configManager.getConfig.bind(configManager);

afterEach(() => {
  configManager.getConfig = originalGetConfig;
});

describe("ImageGenerationWorkflow", () => {
  test("streams complete output to a private current log", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mr-rocket-live-log-"));
    const log = await createImageWorkflowLog(directory);
    const longLine = "x".repeat(5000);
    log.write(`phase\n${longLine}\n`);
    await log.close();

    expect(await readFile(log.path, "utf8")).toBe(`phase\n${longLine}\n`);
    expect(await readlink(log.currentPath)).toBe(basename(log.path));
    expect((await stat(log.path)).mode & 0o777).toBe(0o600);
  });

  test("keeps Agy's prompt flag last", () => {
    const defaultAgy = DEFAULT_CONFIG.agents?.agy;
    expect(
      defaultAgy?.transport === "http" ? undefined : defaultAgy?.args?.at(-1),
    ).toBe("--print");
    const manager = new ConfigManager() as unknown as {
      mergeConfig(config: AppConfig, defaults: AppConfig): AppConfig;
    };
    const merged = manager.mergeConfig(
      {
        ...DEFAULT_CONFIG,
        agents: {
          agy: {
            command: "agy",
            args: ["--print", "--mode", "accept-edits"],
          },
          codex: {
            command: "codex",
            subcommand: "exec",
          },
        },
      },
      DEFAULT_CONFIG,
    );
    const mergedAgy = merged.agents?.agy;
    expect(
      mergedAgy?.transport === "http" ? undefined : mergedAgy?.args?.at(-1),
    ).toBe("--print");
    const mergedCodex = merged.agents?.codex;
    expect(
      mergedCodex?.transport === "http" ? undefined : mergedCodex?.args,
    ).toEqual(["--disable", "plugins"]);
  });

  test("applies reviewer feedback until every check passes", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "mr-rocket-images-"));
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        imageGeneration: {
          mainAgent: "director",
          drawAgent: "draw",
          maxIterations: 3,
          outputDir: outputRoot,
        },
      }) satisfies AppConfig;

    let reviews = 0;
    let draws = 0;
    let drawRepo: string | undefined;
    let refinementAttachments = 0;
    const prompts: string[] = [];
    const runner = {
      async run(prompt: string, options?: RunOptions): Promise<AgentResult> {
        prompts.push(prompt);
        options?.onOutput?.("diagnostic {not json}\n", "stderr");
        if (options?.agentName === "draw") {
          drawRepo = options.repo;
          draws++;
          if (draws === 2)
            refinementAttachments = options.referenceImages?.length || 0;
          const outputDir = prompt.match(/exact directory: (.+)/)?.[1]?.trim();
          if (!outputDir) throw new Error("Missing output directory");
          const image = join(outputDir, `result-${draws}.png`);
          await writeFile(
            image,
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            ),
          );
          return {
            agent: "draw",
            output: `generated metadata {"status":"working"}`,
            stdout: `generated metadata {"status":"working"}`,
            stderr: JSON.stringify({ images: [image] }),
            exitCode: 0,
            duration: 1,
          };
        }
        if (prompt.includes("strict visual reviewer")) {
          reviews++;
          return {
            agent: "director",
            output: `review log\n${JSON.stringify({
              passed: reviews === 2,
              feedback: reviews === 1 ? ["Increase contrast"] : [],
            })}`,
            exitCode: 0,
            duration: 1,
          };
        }
        return {
          agent: "director",
          output: "analysis log",
          stdout: "analysis log",
          stderr: JSON.stringify({
            prompt: "Photorealistic subject",
            checks: ["Correct subject"],
          }),
          exitCode: 0,
          duration: 1,
        };
      },
    };

    const streamed: string[] = [];
    let liveLogPath = "";
    const result = await new ImageGenerationWorkflow(runner).run(
      { prompt: "A portrait" },
      {
        onAgentOutput: (log) =>
          streamed.push(`${log.agent}:${log.stream}:${log.text}`),
        onLogReady: (path) => {
          liveLogPath = path;
        },
        logDirectory: join(outputRoot, "logs"),
      },
    );

    expect(result.iterations).toBe(2);
    expect(draws).toBe(2);
    expect(drawRepo).toBe(outputRoot);
    expect(refinementAttachments).toBe(1);
    expect(result.images[0]).toEndWith("result-2.png");
    expect(result.events.map((event) => event.phase)).toContain("refining");
    expect(result.events.at(-1)?.phase).toBe("completed");
    expect(prompts[0]).toContain('qualifiers such as "sample", "fictional"');
    expect(prompts[1]).toContain("prefer deterministic SVG, HTML, or canvas");
    expect(prompts[2]).toContain("Reject invented copy, labels, watermarks");
    expect(
      streamed.some((line) => line.includes("draw:stderr:diagnostic")),
    ).toBeTrue();
    expect(await readFile(liveLogPath, "utf8")).toContain(
      "[draw:stderr]\ndiagnostic {not json}",
    );
  });

  test("cancels the active local agent process", async () => {
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        agents: {
          slow: {
            command: process.execPath,
            args: ["-e", "setTimeout(() => {}, 10000)"],
          },
        },
      }) satisfies AppConfig;
    const controller = new AbortController();
    const run = new AgentService().run("wait", {
      agentName: "slow",
      signal: controller.signal,
      silent: true,
    });
    setTimeout(() => controller.abort(), 20);

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  test("sends references to a remote agent and saves returned artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mr-rocket-remote-"));
    const reference = join(directory, "reference.png");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(reference, png);
    let receivedAttachments = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { attachments: unknown[] };
        receivedAttachments = body.attachments.length;
        return Response.json({
          output: "done",
          artifacts: [{ name: "remote.png", data: png.toString("base64") }],
        });
      },
    });
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        agents: { remote: { transport: "http", url: server.url.toString() } },
      }) satisfies AppConfig;

    try {
      const result = await new AgentService().run("draw", {
        agentName: "remote",
        referenceImages: [reference],
        artifactDir: directory,
        silent: true,
      });
      expect(receivedAttachments).toBe(1);
      expect(result.output).toBe("done");
      expect(await readFile(result.artifacts![0]!)).toEqual(png);
    } finally {
      server.stop(true);
    }
  });
});
