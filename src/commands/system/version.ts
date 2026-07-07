import type { ParsedArgs } from "../../utils/cli-parser";
import type { Command } from "../command.interface";
import type { CommandOutput } from "../../types/command-output";
import { APP_NAME, APP_VERSION, formatVersion } from "../../version";

export class VersionCommand implements Command {
  name = "version";
  description = "Show current version";
  category = "System";

  async execute(_args: ParsedArgs): Promise<CommandOutput> {
    return {
      success: true,
      message: formatVersion(),
      data: {
        name: APP_NAME,
        version: APP_VERSION,
      },
    };
  }

  printHelp(): string {
    let help = "\nversion\n";
    help += "=======\n";
    help += `${this.description}\n\n`;
    help += "Usage: mr-rocket version [options]\n\n";
    help += "Examples:\n";
    help += "  mr-rocket version\n";
    help += "  mr-rocket --version\n";
    help += "  mr-rocket tui --version\n";
    return help;
  }
}
