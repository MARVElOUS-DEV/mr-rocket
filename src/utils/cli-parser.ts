export interface ParsedArgs {
  command: string[];
  flags: Map<string, boolean>;
  options: Map<string, string>;
  positional: string[];
  json: boolean;
  help: boolean;
}

export interface CommandInfo {
  name: string;
  args: string[];
}

export class CLIParser {
  parse(argv: string[]): ParsedArgs {
    const args = argv.slice(2);

    const result: ParsedArgs = {
      command: [],
      flags: new Map(),
      options: new Map(),
      positional: [],
      json: false,
      help: false,
    };

    let i = 0;
    while (i < args.length) {
      const arg = args[i];

      if (arg === "--json") {
        result.json = true;
      } else if (arg === "--help" || arg === "-h") {
        result.help = true;
      } else if (arg.startsWith("--")) {
        const key = arg.slice(2);
        const nextArg = args[i + 1];

        if (nextArg && !nextArg.startsWith("-")) {
          result.options.set(key, nextArg);
          i++;
        } else {
          result.flags.set(key, true);
        }
      } else if (arg.startsWith("-")) {
        const key = arg.slice(1);
        const nextArg = args[i + 1];

        if (nextArg && !nextArg.startsWith("-")) {
          result.options.set(key, nextArg);
          i++;
        } else {
          result.flags.set(key, true);
        }
      } else {
        result.positional.push(arg);
      }

      i++;
    }

    return result;
  }

  parseCommand(parsed: ParsedArgs): CommandInfo {
    const args = [...parsed.positional];

    if (args.length === 0) {
      return { name: "help", args: [] };
    }

    const name = args[0];
    const commandArgs = args.slice(1);

    return { name, args: commandArgs };
  }

  extractOption<T>(
    options: Map<string, string>,
    key: string,
    defaultValue?: T
  ): T | undefined {
    const value = options.get(key);
    if (value === undefined) {
      return defaultValue;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  extractArray(options: Map<string, string>, key: string): string[] {
    const value = options.get(key);
    if (!value) {
      return [];
    }

    return value.split(",").map((s) => s.trim());
  }
}

export const cliParser = new CLIParser();
