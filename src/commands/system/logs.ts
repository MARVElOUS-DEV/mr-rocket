import { BaseCommand } from "../base-command.ts";
import type { ParsedArgs } from "../../utils/cli-parser.ts";
import type { CommandOutput } from "../../types/command-output.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export class LogsCommand extends BaseCommand {
  override name = "logs";
  override description = "View application logs";
  override category = "System";

  async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const logFile = join(homedir(), ".mr-rocket", "logs", "app.log");
    
    try {
      const content = await readFile(logFile, "utf-8");
      const lines = content.trim().split("\n");
      const limit = parseInt(args.options.get("limit") || "20", 10);
      const tail = lines.slice(-limit).join("\n");

      console.log("\n\x1b[36m--- Latest Application Logs ---\x1b[0m\n");
      console.log(tail);
      console.log("\n\x1b[36m--- End of Logs ---\x1b[0m\n");

      return {
        success: true,
        message: `Showing last ${limit} log entries`,
      };
    } catch (err) {
      return {
        success: false,
        message: "No logs found or failed to read log file",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --limit <number>   Number of lines to show (default: 20)\n";
    return help;
  }
}
