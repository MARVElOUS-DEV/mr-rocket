import { imageGenerationWorkflow } from "../../workflows/image-generation";
import type { CommandOutput } from "../../types/command-output";
import type { ParsedArgs } from "../../utils/cli-parser";
import { BaseCommand } from "../base-command";

export class ImageGenerateCommand extends BaseCommand {
  name = "image generate";
  description = "Generate and verify images with configured agents";
  override category = "Image";

  async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const prompt = args.positional.join(" ").trim();
    if (!prompt) {
      return {
        success: false,
        message:
          "Usage: image generate <prompt> [--reference <path1,path2>] [--output <dir>]",
      };
    }

    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    try {
      const result = await imageGenerationWorkflow.run(
        {
          prompt,
          referenceImages: (args.options.get("reference") || "")
            .split(",")
            .map((path) => path.trim())
            .filter(Boolean),
          outputDir: args.options.get("output"),
        },
        {
          signal: controller.signal,
          onEvent: args.json
            ? undefined
            : (event) =>
                process.stderr.write(`[${event.phase}] ${event.message}\n`),
        },
      );
      return { success: true, data: result, message: result.images.join("\n") };
    } finally {
      process.removeListener("SIGINT", cancel);
    }
  }

  override printHelp(): string {
    return `
image generate
==============
Generate realistic images, review them, and iterate until configured checks pass.

Usage:
  mr-rocket image generate <prompt> [options]

Options:
  --reference <paths>  Comma-separated local reference image paths
  --output <directory> Output root (a unique run directory is created inside)
  --json               Return the workflow result as JSON
`;
  }
}
