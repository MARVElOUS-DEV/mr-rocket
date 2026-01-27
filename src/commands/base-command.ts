import type { Command, CommandContext } from "./command.interface";
import type { ParsedArgs } from "../utils/cli-parser";
import type { CommandOutput } from "../types/command-output";
import { historyManager } from "../core/history-manager";

export abstract class BaseCommand implements Command {
  abstract name: string;
  abstract description: string;
  category?: string;

  protected abstract executeInternal(args: ParsedArgs): Promise<CommandOutput>;

  async execute(args: ParsedArgs): Promise<CommandOutput> {
    const startTime = Date.now();

    try {
      const output = await this.executeInternal(args);
      const duration = Date.now() - startTime;

      await historyManager.record(
        this.name,
        this.parseArgs(args),
        output,
        duration
      );

      return output;
    } catch (err) {
      const duration = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));

      const output: CommandOutput = {
        success: false,
        error,
        message: error.message,
      };

      await historyManager.record(
        this.name,
        this.parseArgs(args),
        output,
        duration
      );

      return output;
    }
  }

  protected parseArgs(args: ParsedArgs): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    args.options.forEach((value, key) => {
      result[key] = value;
    });

    args.flags.forEach((value, key) => {
      result[key] = value;
    });

    if (args.positional.length > 0) {
      result._positional = args.positional;
    }

    return result;
  }

  printHelp(): string {
    let help = `\n${this.name}\n`;
    help += `${"=".repeat(this.name.length)}\n`;
    help += `${this.description}\n\n`;
    help += `Usage: mr-rocket ${this.name} [options]\n\n`;

    return help;
  }
}
