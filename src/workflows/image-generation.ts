import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { configManager } from "../core/config-manager";
import { agentService, type RunOptions } from "../services/agent.service";
import type { AgentResult } from "../types/agent";
import type {
  ImageWorkflowEvent,
  ImageWorkflowInput,
  ImageWorkflowLog,
  ImageWorkflowResult,
} from "../types/image-workflow";
import { createImageWorkflowLog } from "../utils/image-workflow-log";

type AgentRunner = {
  run(prompt: string, options?: RunOptions): Promise<AgentResult>;
};

type WorkflowOptions = {
  signal?: AbortSignal;
  onEvent?: (event: ImageWorkflowEvent) => void;
  onAgentOutput?: (log: ImageWorkflowLog) => void;
  onLogReady?: (path: string, currentPath: string) => void;
  onLogError?: (error: Error) => void;
  logDirectory?: string;
};

type ImagePlan = { prompt: string; checks: string[] };
type ImageReview = { passed: boolean; feedback: string[] };

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function jsonObject(
  text: string,
  requiredKey: string,
): Record<string, unknown> {
  const candidates: Record<string, unknown>[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"' && depth > 0) inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth++;
    } else if (char === "}" && depth > 0 && --depth === 0) {
      try {
        candidates.push(
          JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>,
        );
      } catch {}
    }
  }
  const match = candidates.findLast((candidate) => requiredKey in candidate);
  if (!match)
    throw new Error(`Agent did not return JSON containing "${requiredKey}"`);
  return match;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function expandHome(path: string): string {
  return path === "~"
    ? homedir()
    : path.startsWith("~/")
      ? resolve(homedir(), path.slice(2))
      : resolve(path);
}

function assertAgentSuccess(result: AgentResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${result.agent} failed: ${result.output.trim() || `exit ${result.exitCode}`}`,
    );
  }
}

function agentText(result: AgentResult): string {
  return result.stdout !== undefined || result.stderr !== undefined
    ? `${result.stdout || ""}\n${result.stderr || ""}`
    : result.output;
}

export class ImageGenerationWorkflow {
  constructor(private runner: AgentRunner = agentService) {}

  async run(
    input: ImageWorkflowInput,
    options: WorkflowOptions = {},
  ): Promise<ImageWorkflowResult> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Image prompt is required");

    const config = configManager.getConfig().imageGeneration;
    if (!config) throw new Error("imageGeneration is not configured");
    const maxIterations = Math.max(1, config.maxIterations ?? 3);
    const references = await this.validateReferences(
      input.referenceImages || [],
    );
    const root = expandHome(
      input.outputDir || config.outputDir || "~/.mr-rocket/generated-images",
    );
    const outputDir = resolve(
      root,
      `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
    );
    await mkdir(outputDir, { recursive: true });

    let liveLog: Awaited<ReturnType<typeof createImageWorkflowLog>> | undefined;
    const events: ImageWorkflowEvent[] = [];
    const emit = (
      phase: ImageWorkflowEvent["phase"],
      message: string,
      iteration?: number,
    ) => {
      const event = { phase, message, iteration, timestamp: Date.now() };
      events.push(event);
      liveLog?.write(
        `\n${new Date(event.timestamp).toISOString()} ${iteration ? `${iteration}. ` : ""}[${phase}] ${message}\n`,
      );
      options.onEvent?.(event);
    };

    try {
      liveLog = await createImageWorkflowLog(options.logDirectory);
      options.onLogReady?.(liveLog.path, liveLog.currentPath);
      liveLog.write(
        [
          "Mr-Rocket image workflow live log",
          `Started: ${new Date().toISOString()}`,
          `Prompt: ${prompt}`,
          `References: ${references.length ? references.join(", ") : "(none)"}`,
          `Output: ${outputDir}`,
          "",
        ].join("\n"),
      );
    } catch (cause) {
      options.onLogError?.(
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    }

    const agentOptions = (
      agentName: string,
      images: string[] = references,
    ): RunOptions => ({
      agentName,
      repo: agentName === config.drawAgent ? root : undefined,
      signal: options.signal,
      referenceImages: images,
      artifactDir: outputDir,
      silent: true,
      onOutput: (text, stream) => {
        const timestamp = Date.now();
        const cleanText = stripVTControlCharacters(text).replaceAll("\r", "");
        liveLog?.write(
          `${new Date(timestamp).toISOString()} [${agentName}:${stream}]\n${cleanText}${cleanText.endsWith("\n") ? "" : "\n"}`,
        );
        options.onAgentOutput?.({
          agent: agentName,
          stream,
          text,
          timestamp,
        });
      },
    });

    try {
      emit("understanding", `${config.mainAgent} is refining the request`);
      const planResult = await this.runner.run(
        this.planPrompt(prompt, references),
        agentOptions(config.mainAgent),
      );
      assertAgentSuccess(planResult);
      const planJson = jsonObject(agentText(planResult), "prompt");
      const plan: ImagePlan = {
        prompt:
          typeof planJson.prompt === "string" && planJson.prompt.trim()
            ? planJson.prompt.trim()
            : prompt,
        checks: stringList(planJson.checks),
      };
      if (plan.checks.length === 0)
        plan.checks.push(
          "Matches the user's requested subject, composition, and realistic style",
        );

      let feedback: string[] = [];
      let previousImages: string[] = [];
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        emit(
          iteration === 1 ? "generating" : "refining",
          `${config.drawAgent} is ${iteration === 1 ? "generating" : "applying review feedback"}`,
          iteration,
        );
        const drawResult = await this.runner.run(
          this.drawPrompt(plan, feedback, outputDir, iteration),
          agentOptions(config.drawAgent, [...references, ...previousImages]),
        );
        assertAgentSuccess(drawResult);
        const images = await this.resolveGeneratedImages(drawResult, outputDir);
        previousImages = images;
        emit(
          "verifying",
          `${config.mainAgent} is checking ${images.length} image(s)`,
          iteration,
        );
        const reviewResult = await this.runner.run(
          this.reviewPrompt(prompt, plan, images, iteration),
          agentOptions(config.mainAgent, images),
        );
        assertAgentSuccess(reviewResult);
        const reviewJson = jsonObject(agentText(reviewResult), "passed");
        const review: ImageReview = {
          passed: reviewJson.passed === true,
          feedback: stringList(reviewJson.feedback),
        };
        if (review.passed) {
          emit(
            "completed",
            `All ${plan.checks.length} checks passed`,
            iteration,
          );
          const result = {
            images,
            refinedPrompt: plan.prompt,
            checks: plan.checks,
            iterations: iteration,
            events,
          };
          liveLog?.write(images.map((image) => `IMAGE: ${image}`).join("\n") + "\n");
          return result;
        }
        feedback = review.feedback.length
          ? review.feedback
          : [
              "The verification agent rejected the result without details; inspect and improve it",
            ];
      }
      throw new Error(
        `Images did not pass verification after ${maxIterations} iteration(s)`,
      );
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        emit("cancelled", "Generation cancelled");
        throw Object.assign(new Error("Image generation cancelled"), {
          name: "AbortError",
        });
      }
      emit("failed", error instanceof Error ? error.message : String(error));
      liveLog?.write(
        `ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      throw error;
    } finally {
      await liveLog?.close().catch((cause) =>
        options.onLogError?.(
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );
    }
  }

  private async validateReferences(paths: string[]): Promise<string[]> {
    return Promise.all(
      paths.map(async (path) => {
        const resolved = expandHome(path.trim());
        const file = Bun.file(resolved);
        if (!(await file.exists()) || !file.type.startsWith("image/")) {
          throw new Error(`Reference image is missing or unsupported: ${path}`);
        }
        return resolved;
      }),
    );
  }

  private async resolveGeneratedImages(
    result: AgentResult,
    outputDir: string,
  ): Promise<string[]> {
    let reported: string[] = result.artifacts || [];
    if (reported.length === 0) {
      const parsed = jsonObject(agentText(result), "images");
      reported = stringList(parsed.images);
    }
    if (reported.length === 0)
      throw new Error(`${result.agent} returned no images`);

    const realOutputDir = await realpath(outputDir);
    return Promise.all(
      reported.map(async (path) => {
        const resolved = isAbsolute(path) ? path : resolve(outputDir, path);
        const real = await realpath(resolved).catch(() => "");
        const extension = real.slice(real.lastIndexOf(".")).toLowerCase();
        if (
          !real ||
          relative(realOutputDir, real).startsWith("..") ||
          !IMAGE_EXTENSIONS.has(extension)
        ) {
          throw new Error(
            `Generated image must be a PNG, JPEG, or WebP inside ${outputDir}: ${path}`,
          );
        }
        if (!(await stat(real)).isFile())
          throw new Error(`Generated image is not a file: ${path}`);
        return real;
      }),
    );
  }

  private planPrompt(prompt: string, references: string[]): string {
    return `You are the image director. Turn the user's request into a precise production prompt. Keep the user's intent and supplied wording authoritative: do not invent concepts, copy, labels, watermarks, disclaimers, or qualifiers such as "sample", "fictional", or "illustrative" unless the user requested them or they are required for safety. Respect explicit style requests. Inspect every attached reference image and preserve requested identity, objects, composition, lighting, camera, text, and constraints. For text-heavy designs, require exact legible copy and deterministic layout rendering when available; reserve generative rendering for imagery.\n\nUser request:\n${prompt}\n\nReference image paths:\n${references.length ? references.join("\n") : "None"}\n\nReturn ONLY JSON:\n{"prompt":"complete generation prompt","checks":["objective visual acceptance check"]}`;
  }

  private drawPrompt(
    plan: ImagePlan,
    feedback: string[],
    outputDir: string,
    iteration: number,
  ): string {
    return `You are the drawing agent. Generate or modify the image files now using your available tools. Do not merely describe an image. Follow the production prompt without adding unrequested copy, labels, watermarks, disclaimers, or qualifiers. For text-heavy designs, prefer deterministic SVG, HTML, or canvas layout so supplied text stays exact and legible; use image generation for the visual elements. Default to photorealistic imagery unless the production prompt requests another style. Use attached references and previous images. Write every final candidate inside this exact directory: ${outputDir}\n\nProduction prompt:\n${plan.prompt}\n\nAcceptance checks:\n${plan.checks.map((check) => `- ${check}`).join("\n")}\n\nReview feedback for iteration ${iteration}:\n${feedback.length ? feedback.map((item) => `- ${item}`).join("\n") : "None; create the first candidates."}\n\nAfter the files exist, your final response must be exactly one JSON object with absolute paths and no prose:\n{"images":["${outputDir}/image.png"]}`;
  }

  private reviewPrompt(
    userPrompt: string,
    plan: ImagePlan,
    images: string[],
    iteration: number,
  ): string {
    return `You are the strict visual reviewer. Inspect every attached generated image against the original request and every acceptance check. Reject invented copy, labels, watermarks, disclaimers, or qualifiers that the user did not request, and reject missing, altered, or illegible supplied text. Pass only when all checks succeed.\n\nOriginal request:\n${userPrompt}\n\nProduction prompt:\n${plan.prompt}\n\nChecks:\n${plan.checks.map((check) => `- ${check}`).join("\n")}\n\nGenerated image paths (iteration ${iteration}):\n${images.join("\n")}\n\nReturn ONLY JSON:\n{"passed":true,"feedback":[]}\nIf any check fails, set passed to false and provide concrete visual edit instructions in feedback.`;
  }
}

export const imageGenerationWorkflow = new ImageGenerationWorkflow();
