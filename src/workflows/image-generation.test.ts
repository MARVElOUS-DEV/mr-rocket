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

  test("merges process capabilities into existing agent configs", () => {
    const defaultAgy = DEFAULT_CONFIG.agents?.agy;
    expect(
      defaultAgy?.transport === "http"
        ? undefined
        : defaultAgy?.capabilities?.nonInteractiveArgs?.at(-1),
    ).toBe("--print");
    const manager = new ConfigManager() as unknown as {
      mergeConfig(config: AppConfig, defaults: AppConfig): AppConfig;
    };
    const merged = manager.mergeConfig(
      {
        ...DEFAULT_CONFIG,
        imageGeneration: {
          ...DEFAULT_CONFIG.imageGeneration!,
          maxIterations: 30,
        },
        agents: {
          cursor: {
            command: "agent",
            args: ["--model", "auto", "--trust"],
          },
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
      mergedAgy?.transport === "http"
        ? undefined
        : mergedAgy?.capabilities?.nonInteractiveArgs?.at(-1),
    ).toBe("--print");
    const mergedCursor = merged.agents?.cursor;
    expect(
      mergedCursor?.transport === "http" ? undefined : mergedCursor?.args,
    ).toEqual(["--model", "auto", "--trust"]);
    expect(
      mergedCursor?.transport === "http"
        ? undefined
        : mergedCursor?.capabilities,
    ).toEqual(
      DEFAULT_CONFIG.agents?.cursor?.transport === "http"
        ? undefined
        : DEFAULT_CONFIG.agents?.cursor?.capabilities,
    );
    expect(mergedCursor?.timeoutMs).toBe(20 * 60 * 1000);
    expect(merged.imageGeneration?.maxIterations).toBe(30);
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
    let refinementContinues = false;
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
          if (draws === 2)
            refinementContinues = options.continueSession === true;
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
      {
        prompt: "A portrait",
        maxIterations: 2,
        maxDurationMs: 5 * 60 * 1000,
      },
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
    expect(drawRepo).toStartWith(`${outputRoot}/`);
    expect(refinementAttachments).toBe(1);
    expect(refinementContinues).toBeTrue();
    expect(result.verified).toBeTrue();
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
    expect(await readFile(liveLogPath, "utf8")).toContain(
      "Maximum iterations: 2",
    );
    expect(await readFile(liveLogPath, "utf8")).toContain(
      "Maximum duration: 300000ms",
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

  test("applies declared process capabilities independent of agent name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mr-rocket-agent-caps-"));
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        agents: {
          illustrator: {
            command: process.execPath,
            args: [
              "-e",
              "console.log(JSON.stringify(process.argv.slice(1)))",
              "--",
              "--print",
            ],
            capabilities: {
              nonInteractiveArgs: ["--trust", "--print"],
              workspaceArg: "--workspace",
              resumeArgs: ["--continue"],
            },
          },
        },
      }) satisfies AppConfig;

    const result = await new AgentService().run("draw", {
      agentName: "illustrator",
      repo: directory,
      continueSession: true,
      silent: true,
    });

    expect(JSON.parse(result.stdout!)).toEqual([
      "--trust",
      "--print",
      "--workspace",
      directory,
      "--continue",
      "draw",
    ]);
  });

  test("streams JSON-lines events for a renamed compatible agent", async () => {
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        agents: {
          illustrator: {
            command: process.execPath,
            args: [
              "-e",
              `console.log(JSON.stringify({type:"system",subtype:"init"})); console.log(JSON.stringify({type:"thinking",subtype:"delta",text:"working"})); console.log(JSON.stringify({type:"result",result:'{"images":["/tmp/final.png"]}'}));`,
            ],
            capabilities: {
              output: {
                protocol: "json-lines",
                args: ["--output-format", "stream-json"],
              },
            },
          },
        },
      }) satisfies AppConfig;
    const chunks: string[] = [];
    const result = await new AgentService().run("draw", {
      agentName: "illustrator",
      silent: true,
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(chunks.join("")).toContain('"subtype":"delta"');
    expect(result.stdout).toBe('{"images":["/tmp/final.png"]}');
    expect(result.output).toBe(result.stdout!);
  });

  test("uses plain output and a fresh session when capabilities are absent", async () => {
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        agents: {
          basic: {
            command: process.execPath,
            args: ["-e", "console.log(process.argv.slice(1).join('|'))"],
          },
        },
      }) satisfies AppConfig;

    const result = await new AgentService().run("draw", {
      agentName: "basic",
      continueSession: true,
      silent: true,
    });

    expect(result.stdout?.trim()).toBe("draw");
  });

  test("recovers a completed image when the draw agent times out", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "mr-rocket-recovery-"));
    const reference = join(outputRoot, "reference.png");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(reference, png);
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        imageGeneration: {
          mainAgent: "director",
          drawAgent: "cursor",
          maxIterations: 1,
          outputDir: outputRoot,
        },
      }) satisfies AppConfig;

    let drawPrompt = "";
    const runner = {
      async run(prompt: string, options?: RunOptions): Promise<AgentResult> {
        if (options?.agentName === "cursor") {
          drawPrompt = prompt;
          const outputDir = prompt.match(/exact directory: (.+)/)?.[1]?.trim();
          if (!outputDir) throw new Error("Missing output directory");
          await writeFile(join(outputDir, "image.png"), png);
          return {
            agent: "cursor",
            output: "cursor timed out after 600000ms",
            stdout: '{"type":"thinking","text":"rendered"}\n',
            stderr: "",
            exitCode: 143,
            duration: 600000,
            timedOut: true,
          };
        }
        if (prompt.includes("strict visual reviewer")) {
          return {
            agent: "director",
            output: '{"passed":true,"feedback":[]}',
            exitCode: 0,
            duration: 1,
          };
        }
        return {
          agent: "director",
          output: '{"prompt":"Correct the document","checks":["Exact text"]}',
          exitCode: 0,
          duration: 1,
        };
      },
    };

    const result = await new ImageGenerationWorkflow(runner).run({
      prompt: "Fix the document",
      referenceImages: [reference],
    });

    expect(result.images[0]).toEndWith("/image.png");
    expect(drawPrompt).toContain(reference);
    expect(drawPrompt).toContain("Do not search for or reuse images");
    expect(
      result.events.some((event) =>
        event.message.includes("continuing with verification"),
      ),
    ).toBeTrue();
  });

  test("returns the best candidate after the iteration budget", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "mr-rocket-best-"));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
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
    const runner = {
      async run(prompt: string, options?: RunOptions): Promise<AgentResult> {
        if (options?.agentName === "draw") {
          const outputDir = prompt.match(/exact directory: (.+)/)?.[1]?.trim();
          if (!outputDir) throw new Error("Missing output directory");
          const image = join(outputDir, "image.png");
          await writeFile(image, png);
          return {
            agent: "draw",
            output: JSON.stringify({ images: [image] }),
            exitCode: 0,
            duration: 1,
          };
        }
        if (prompt.includes("strict visual reviewer")) {
          return {
            agent: "director",
            output: '{"passed":false,"feedback":["Increase contrast"]}',
            exitCode: 0,
            duration: 1,
          };
        }
        return {
          agent: "director",
          output: '{"prompt":"A poster","checks":["Readable"]}',
          exitCode: 0,
          duration: 1,
        };
      },
    };

    const result = await new ImageGenerationWorkflow(runner).run({
      prompt: "Create a poster",
      maxIterations: 1,
    });

    expect(result.verified).toBeFalse();
    expect(result.feedback).toEqual(["Increase contrast"]);
    expect(result.images[0]).toEndWith("/image.png");
    expect(result.events.at(-1)?.phase).toBe("completed");
  });

  test("rejects invalid per-run workflow limits before launching agents", async () => {
    configManager.getConfig = () => DEFAULT_CONFIG;
    let calls = 0;
    const runner = {
      async run(): Promise<AgentResult> {
        calls++;
        throw new Error("should not run");
      },
    };

    await expect(
      new ImageGenerationWorkflow(runner).run({
        prompt: "Create a poster",
        maxIterations: 31,
      }),
    ).rejects.toThrow("Maximum iterations must be an integer from 1 to 30");
    await expect(
      new ImageGenerationWorkflow(runner).run({
        prompt: "Create a poster",
        maxDurationMs: 61 * 60 * 1000,
      }),
    ).rejects.toThrow("Maximum duration must be from 1 to 60 minutes");
    expect(calls).toBe(0);
  });

  test("rejects a reference path used as the entire prompt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mr-rocket-path-prompt-"));
    const reference = join(directory, "reference.png");
    await writeFile(
      reference,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        imageGeneration: {
          ...DEFAULT_CONFIG.imageGeneration!,
          outputDir: directory,
        },
      }) satisfies AppConfig;

    await expect(
      new ImageGenerationWorkflow().run({
        prompt: reference,
        referenceImages: [reference],
      }),
    ).rejects.toThrow("Image prompt must describe what to create or change");
  });

  test("rejects references for a local draw agent without path support", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mr-rocket-no-paths-"));
    const reference = join(directory, "reference.png");
    await writeFile(
      reference,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    configManager.getConfig = () =>
      ({
        ...DEFAULT_CONFIG,
        agents: {
          director: { command: "director" },
          draw: {
            command: "draw",
            capabilities: { localImagePaths: false },
          },
        },
        imageGeneration: {
          mainAgent: "director",
          drawAgent: "draw",
          maxIterations: 1,
          outputDir: directory,
        },
      }) satisfies AppConfig;

    await expect(
      new ImageGenerationWorkflow().run({
        prompt: "Restyle the supplied image",
        referenceImages: [reference],
      }),
    ).rejects.toThrow("does not support local reference image paths");
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
