import { BaseCommand } from "../base-command";
import type { ParsedArgs } from "../../utils/cli-parser";
import type { CommandOutput } from "../../types/command-output";
import { agentService } from "../../services/agent.service";

export class AgentListCommand extends BaseCommand {
  name = "agent list";
  description = "List configured AI agents";
  override category = "Agent";

  async executeInternal(_args: ParsedArgs): Promise<CommandOutput> {
    const agents = agentService.getAvailableAgents();

    if (agents.length === 0) {
      return {
        success: true,
        message: "No agents configured. Add agents to ~/.mr-rocket/config.json",
      };
    }

    return {
      success: true,
      data: { headers: ["Agent"], rows: agents.map((a) => [a]) },
      message: `${agents.length} agent(s) configured`,
    };
  }
}
