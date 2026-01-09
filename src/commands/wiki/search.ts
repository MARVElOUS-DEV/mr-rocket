import { BaseCommand } from "../base-command.ts";
import type { ParsedArgs } from "../../utils/cli-parser.ts";
import type { CommandOutput } from "../../models/command-output.ts";
import { configManager } from "../../core/config-manager.ts";
import { ConfluenceService } from "../../services/confluence.service.ts";
import { ValidationError, ValidationHelper } from "../../utils/validation.ts";

export class WikiSearchCommand extends BaseCommand {
  name = "wiki search";
  description = "Search wiki pages";
  override category = "Wiki";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = await configManager.load();
    const query = args.options.get("query") || args.options.get("q");

    if (!query) {
      throw new ValidationError("Search query required. Provide via --query");
    }

    const limitRaw = args.options.get("limit");
    const offsetRaw = args.options.get("offset");
    const spaceKey = args.options.get("space") || config.confluence.defaultSpaceKey;

    let limit: number | undefined;
    if (limitRaw) {
      const parsed = parseInt(limitRaw, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new ValidationError("Limit must be a positive number");
      }
      limit = parsed;
    }

    let offset: number | undefined;
    if (offsetRaw) {
      const parsed = parseInt(offsetRaw, 10);
      if (isNaN(parsed) || parsed < 0) {
        throw new ValidationError("Offset must be zero or a positive number");
      }
      offset = parsed;
    }

    ValidationHelper.validUrl(config.confluence.host);
    ValidationHelper.nonEmpty(config.confluence.token, "confluence token");
    if (config.confluence.token === "YOUR_CONFLUENCE_PAT_HERE") {
      throw new ValidationError("Confluence token is not configured. Please edit ~/.mr-rocket/config.json");
    }

    const confluence = new ConfluenceService(
      config.confluence.host,
      config.confluence.token
    );
    const results = await confluence.searchPages(query, { limit, offset, spaceKey });

    return {
      success: true,
      data: results,
      message: `Found ${results.length} pages`,
      meta: {
        count: results.length,
      },
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --query <text>        Search query\n";
    help += "  --limit <number>      Max results\n";
    help += "  --offset <number>     Offset for pagination\n";
    help += "  --space <key>         Space key filter\n\n";
    help += "Example:\n";
    help += '  mr-rocket wiki search --query "workflow automation"\n';
    return help;
  }
}
