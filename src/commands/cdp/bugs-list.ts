import { BaseCommand } from "../base-command.js";
import type { ParsedArgs } from "../../utils/cli-parser.js";
import type { CommandOutput } from "../../models/command-output.js";
import { CDPService } from "../../services/cdp.service.js";
import { configManager } from "../../core/config-manager.js";

export class CDPBugsListCommand extends BaseCommand {
  name = "cdp bugs list";
  description = "List bugs from CDP";
  override category = "CDP";

  protected async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = configManager.getConfig();

    if (!config.cdp) {
      return {
        success: false,
        message: "CDP is not configured. Add 'cdp' section to ~/.mr-rocket/config.json",
      };
    }

    const service = new CDPService(config.cdp);

    const filter = {
      status: args.options.get("status"),
      priority: args.options.get("priority"),
      assignee: args.options.get("assignee"),
      search: args.options.get("search") || args.options.get("q"),
    };

    const bugs = await service.listBugs(filter);

    if (args.flags.get("json")) {
      return {
        success: true,
        data: bugs,
        message: JSON.stringify(bugs, null, 2),
      };
    }

    if (bugs.length === 0) {
      return {
        success: true,
        data: bugs,
        message: "No bugs found matching the filter criteria.",
      };
    }

    let message = `Found ${bugs.length} bug(s):\n\n`;
    for (const bug of bugs) {
      message += `#${bug.id} [${bug.status}] ${bug.title}\n`;
      message += `  Priority: ${bug.priority}`;
      if (bug.assignee) {
        message += ` | Assignee: ${bug.assignee}`;
      }
      message += `\n`;
    }

    return {
      success: true,
      data: bugs,
      message,
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --status <status>      Filter by status (e.g., open, closed)\n";
    help += "  --priority <priority>  Filter by priority (e.g., high, medium, low)\n";
    help += "  --assignee <user>      Filter by assignee\n";
    help += "  --search, -q <query>   Search bugs by text\n";
    help += "  --json                 Output in JSON format\n\n";
    help += "Examples:\n";
    help += "  mr-rocket cdp bugs list\n";
    help += "  mr-rocket cdp bugs list --status open\n";
    help += "  mr-rocket cdp bugs list --priority high --assignee @me\n";
    help += "  mr-rocket cdp bugs list -q \"login issue\" --json\n";
    return help;
  }
}
