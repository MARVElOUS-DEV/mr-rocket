import { BaseCommand } from "../base-command";
import type { ParsedArgs } from "../../utils/cli-parser";
import type { CommandOutput } from "../../types/command-output";
import { agentService } from "../../services/agent.service";

export class AgentRunCommand extends BaseCommand {
  name = "agent run";
  description = "Run a prompt through an AI coding agent";
  override category = "Agent";

  async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const prompt = args.positional.join(" ");
    if (!prompt) {
      return {
        success: false,
        message:
          "Usage: agent run <prompt> [--agent <name>] [--agents <name1,name2>]",
      };
    }

    const agentsOption = args.options.get("agents");
    if (agentsOption) {
      const names = agentsOption.split(",").map((s) => s.trim());
      const results = await agentService.runMultiple(prompt, names);
      return {
        success: results.every((r) => r.exitCode === 0),
        data: results,
        message: `Ran prompt through ${names.length} agents`,
      };
    }

    const agentName = args.options.get("agent");
    const result = await agentService.run(prompt, agentName);

    return {
      success: result.exitCode === 0,
      data: result,
      message: result.output,
    };
  }

  override printHelp(): string {
    return `
agent run
=========
Run a prompt through an AI coding agent.

Usage:
  mr-rocket agent run <prompt> [options]

Options:
  --agent <name>        Use specific agent (default: from config)
  --agents <n1,n2>      Run through multiple agents in parallel

Examples:
  mr-rocket agent run "explain this code"
  mr-rocket agent run "refactor for readability" --agent codex
  mr-rocket agent run "review this" --agents claude,codex
`;
  }
}
