import { BaseCommand } from "../base-command";
import type { ParsedArgs } from "../../utils/cli-parser";
import type { CommandOutput } from "../../models/command-output";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";

const IMAGES_DIR = join(homedir(), ".mr-rocket", "images");

type BugImages = { bugId: string; images: string[] };

export class BugImagesCommand extends BaseCommand {
  name = "bug images";
  description = "List all bugs and their attached images";
  override category = "Bug";

  protected async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    if (!existsSync(IMAGES_DIR)) {
      return { success: true, message: "No images stored yet", data: [] };
    }

    const bugs = readdirSync(IMAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d): BugImages => ({
        bugId: d.name,
        images: readdirSync(join(IMAGES_DIR, d.name)).map((f) =>
          join(IMAGES_DIR, d.name, f)
        ),
      }))
      .filter((b) => b.images.length > 0);

    if (bugs.length === 0) {
      return { success: true, message: "No images stored yet", data: [] };
    }

    if (args.json) {
      return { success: true, data: bugs, message: JSON.stringify(bugs, null, 2) };
    }

    // Format table
    const lines = ["Bug ID\t\tImages"];
    lines.push("-".repeat(60));
    for (const bug of bugs) {
      lines.push(`${bug.bugId}\t\t${bug.images.join(", ")}`);
    }

    return { success: true, message: lines.join("\n"), data: bugs };
  }
}
