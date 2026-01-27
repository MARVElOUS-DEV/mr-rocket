import { BaseCommand } from "../base-command.js";
import type { ParsedArgs } from "../../utils/cli-parser.js";
import type { CommandOutput } from "../../types/command-output.js";
import { CDPService } from "../../services/cdp.service.js";
import { configManager } from "../../core/config-manager.js";

export class CDPBugsShowCommand extends BaseCommand {
  name = "cdp bugs show";
  description = "Show details of a specific bug";
  override category = "CDP";

  protected async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = configManager.getConfig();

    if (!config.cdp) {
      return {
        success: false,
        message: "CDP is not configured. Add 'cdp' section to ~/.mr-rocket/config.json",
      };
    }

    const bugId = args.positional[0];
    if (!bugId) {
      return {
        success: false,
        message: "Bug ID is required. Usage: mr-rocket cdp bugs show <bug-id>",
      };
    }

    const service = new CDPService(config.cdp);
    const response = await service.getBug(bugId);
    const bug = response.data.fieldMap;

    if (args.flags.get("json")) {
      return {
        success: true,
        data: bug,
        message: JSON.stringify(bug, null, 2),
      };
    }

    let message = `Bug #${bug.id}\n`;
    message += `${"=".repeat(40)}\n`;
    message += `Title: ${bug.title}\n`;
    message += `Status: ${bug.status}\n`;
    message += `Priority: ${bug.priority}\n`;
    if (bug.assignee) {
      message += `Assignee: ${bug.assignee}\n`;
    }
    message += `Created: ${bug.createdAt}\n`;
    message += `Updated: ${bug.updatedAt}\n`;
    if (bug.description) {
      message += `\nDescription:\n${bug.description}\n`;
    }

    return {
      success: true,
      data: bug,
      message,
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Arguments:\n";
    help += "  <bug-id>   The ID of the bug to show\n\n";
    help += "Options:\n";
    help += "  --json     Output in JSON format\n\n";
    help += "Examples:\n";
    help += "  mr-rocket cdp bugs show 123\n";
    help += "  mr-rocket cdp bugs show BUG-456 --json\n";
    return help;
  }
}
