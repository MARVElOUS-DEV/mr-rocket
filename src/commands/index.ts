import type { Command } from "./command.interface";
import type { ParsedArgs } from "../utils/cli-parser";
import { error, success } from "../core/colors";

class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  getByCategory(category: string): Command[] {
    return this.getAll().filter((cmd) => cmd.category === category);
  }

  async execute(parsed: ParsedArgs): Promise<boolean> {
    const match = this.resolveCommand(parsed);
    const command = match?.command;

    if (!command) {
      console.log(error(`Unknown command: ${parsed.positional[0] || ""}`));
      this.printGlobalHelp();
      return false;
    }

    if (parsed.help) {
      console.log(command.printHelp?.() || this.printCommandHelp(command));
      return true;
    }

    try {
      const output = await command.execute(match?.parsed ?? parsed);

      if (output.success) {
        if (output.message) {
          console.log(success(output.message));
        }
        return true;
      } else {
        console.log(error(output.message || output.error?.message || "Command failed"));
        return false;
      }
    } catch (err) {
      console.log(error(err instanceof Error ? err.message : String(err)));
      return false;
    }
  }

  private resolveCommand(
    parsed: ParsedArgs
  ): { command: Command; parsed: ParsedArgs } | null {
    if (parsed.positional.length === 0) {
      return null;
    }

    const candidates = this.getAll()
      .map((cmd) => ({ cmd, tokens: cmd.name.split(" ") }))
      .sort((a, b) => b.tokens.length - a.tokens.length);

    for (const candidate of candidates) {
      const tokens = candidate.tokens;
      const matches = tokens.every((token, index) => parsed.positional[index] === token);
      if (matches) {
        const trimmed: ParsedArgs = {
          ...parsed,
          positional: parsed.positional.slice(tokens.length),
        };
        return { command: candidate.cmd, parsed: trimmed };
      }
    }

    return null;
  }

  printGlobalHelp(): void {
    console.log("\nMr-Rocket - Your daily workflow CLI tool\n");
    console.log("Usage: mr-rocket <command> [options]\n");
    console.log("Commands:");

    const categories = new Set(this.getAll().map((cmd) => cmd.category || "General"));

    categories.forEach((category) => {
      console.log(`\n  ${category}:`);
      this.getByCategory(category).forEach((cmd) => {
        console.log(`    ${cmd.name.padEnd(20)} ${cmd.description}`);
      });
    });

    console.log("\nGlobal Options:");
    console.log("  --json               Output JSON format");
    console.log("  --help, -h           Show help for command\n");
  }

  private printCommandHelp(command: Command): string {
    return command.printHelp?.() || `${command.name}: ${command.description}`;
  }
}

export const commandRegistry = new CommandRegistry();
