import { BaseCommand } from "../base-command.js";
import type { ParsedArgs } from "../../utils/cli-parser.js";
import type { CommandOutput } from "../../models/command-output.js";
import { CDPService } from "../../services/cdp.service.js";
import { configManager } from "../../core/config-manager.js";

export class CDPStatusCommand extends BaseCommand {
  name = "cdp status";
  description = "Check CDP authentication status";
  category = "CDP";

  protected async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = configManager.getConfig();

    if (!config.cdp) {
      return {
        success: false,
        message: "CDP is not configured. Add 'cdp' section to ~/.mr-rocket/config.json",
      };
    }

    const service = new CDPService(config.cdp);
    await service.init().catch(() => {
      // Ignore init errors for status command, it will be handled by getAuthStatus
    });
    const status = await service.getAuthStatus();

    if (args.flags.get("json")) {
      return {
        success: true,
        data: status,
        message: JSON.stringify(status, null, 2),
      };
    }

    if (!status.authenticated) {
      return {
        success: false,
        message: `CDP auth not available: ${status.error}`,
      };
    }

    let message = `CDP Authentication Status:\n`;
    message += `  Domain: ${status.domain}\n`;
    message += `  Cookies: ${status.cookieCount}\n`;
    message += `  Synced: ${status.syncedAt}\n`;
    message += `  Status: ${status.isStale ? "⚠️  Stale (refresh recommended)" : "✓ Valid"}`;

    return {
      success: true,
      data: status,
      message,
    };
  }

  printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --json       Output in JSON format\n\n";
    help += "Example:\n";
    help += "  mr-rocket cdp status\n";
    help += "  mr-rocket cdp status --json\n";
    return help;
  }
}
