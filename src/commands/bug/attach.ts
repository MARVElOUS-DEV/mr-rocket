import { BaseCommand } from "../base-command";
import type { ParsedArgs } from "../../utils/cli-parser";
import type { CommandOutput } from "../../types/command-output";
import { saveClipboardImage } from "../../utils/clipboard-image";
import { homedir } from "node:os";
import { join, extname } from "node:path";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";

const IMAGES_DIR = join(homedir(), ".mr-rocket", "images");

export class BugAttachCommand extends BaseCommand {
  name = "bug attach";
  description = "Attach image to a bug (from clipboard or file)";
  override category = "Bug";

  protected async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const bugId = args.positional[0];
    if (!bugId) {
      return { success: false, message: "Usage: bug attach <bugId> [--file <path>]" };
    }

    const filePath = args.options.get("file");
    const bugDir = join(IMAGES_DIR, bugId);

    if (!existsSync(bugDir)) {
      mkdirSync(bugDir, { recursive: true });
    }

    // Get next sequence number
    const existing = existsSync(bugDir) ? readdirSync(bugDir) : [];
    const seq = String(existing.length + 1).padStart(3, "0");

    let sourcePath: string | null;
    let ext: string;

    if (filePath) {
      if (!existsSync(filePath)) {
        return { success: false, message: `File not found: ${filePath}` };
      }
      sourcePath = filePath;
      ext = extname(filePath) || ".png";
    } else {
      sourcePath = await saveClipboardImage();
      if (!sourcePath) {
        return { success: false, message: "No image found in clipboard" };
      }
      ext = ".png";
    }

    const destPath = join(bugDir, `${seq}${ext}`);
    copyFileSync(sourcePath, destPath);

    const data = { bugId, path: destPath };
    if (args.json) {
      return { success: true, data, message: JSON.stringify(data, null, 2) };
    }

    return { success: true, message: `Image saved to ${destPath}`, data };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --file <path>  Image file path (uses clipboard if not provided)\n";
    return help;
  }
}
