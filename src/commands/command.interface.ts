import type { ParsedArgs } from "../utils/cli-parser";
import type { CommandOutput } from "../models/command-output";

export interface Command {
  name: string;
  description: string;
  category?: string;
  execute(args: ParsedArgs): Promise<CommandOutput>;
  printHelp?(): string;
}

export interface CommandContext {
  json?: boolean;
}
