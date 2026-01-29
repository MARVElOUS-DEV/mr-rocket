import { BaseCommand } from "../base-command.ts";
import type { ParsedArgs } from "../../utils/cli-parser.ts";
import type { CommandOutput } from "../../types/command-output.ts";
import { configManager } from "../../core/config-manager.ts";
import { logger } from "../../core/logger.ts";
import { ConfluenceService } from "../../services/confluence.service.ts";
import { ValidationError, ValidationHelper } from "../../utils/validation.ts";

export class WikiReadCommand extends BaseCommand {
  name = "wiki read";
  description = "Read a wiki page by title";
  override category = "Wiki";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = await configManager.load();
    const title = args.options.get("title") || args.options.get("t");

    if (!title) {
      throw new ValidationError("Page title required. Provide via --title");
    }

    const spaceKey = args.options.get("space") || config.confluence.defaultSpaceKey;

    ValidationHelper.validUrl(config.confluence.host);
    ValidationHelper.nonEmpty(config.confluence.token, "confluence token");
    if (config.confluence.token === "YOUR_CONFLUENCE_PAT_HERE") {
      throw new ValidationError("Confluence token is not configured. Please edit ~/.mr-rocket/config.json");
    }

    const confluence = new ConfluenceService(
      config.confluence.host,
      config.confluence.token,
      config.confluence.tls,
      config.confluence.apiPrefix,
      config.cdp,
    );
    logger.debug("Executing wiki read", { title, spaceKey, host: config.confluence.host });
    const page = await confluence.readPage(title, spaceKey);

    return {
      success: true,
      data: page,
      message: `Loaded ${page.title}`,
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --title <title>       Page title to read\n";
    help += "  --space <key>         Space key filter\n\n";
    help += "Example:\n";
    help += '  mr-rocket wiki read --title "GitLab"\n';
    return help;
  }
}
