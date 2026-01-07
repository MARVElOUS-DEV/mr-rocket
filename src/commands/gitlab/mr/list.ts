import { BaseCommand } from "../../base-command";
import type { ParsedArgs } from "../../../utils/cli-parser";
import type { CommandOutput } from "../../../models/command-output";
import { GitLabService } from "../../../services/gitlab.service";
import { configManager } from "../../../core/config-manager";
import { cliParser } from "../../../utils/cli-parser";
import { ValidationHelper, ValidationError } from "../../../utils/validation";

export class MrListCommand extends BaseCommand {
  name = "mr list";
  description = "List merge requests";
  override category = "GitLab";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = await configManager.load();
    const projectId = args.options.get("project") || config.gitlab.defaultProjectId;

    if (!projectId) {
      throw new ValidationError(
        "Project ID required. Provide via --project flag or config"
      );
    }

    const state = args.options.get("state") as "opened" | "closed" | "merged" | undefined;
    const search = args.options.get("search");
    const labels = cliParser.extractArray(args.options, "labels");
    const author = args.options.get("author");
    const assignee = args.options.get("assignee");

    let authorId: number | undefined;
    if (author) {
      const parsed = parseInt(author, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new ValidationError(`Invalid author ID: ${author}. Must be a positive number.`);
      }
      authorId = parsed;
    }

    let assigneeId: string | undefined;
    if (assignee) {
      const parsed = parseInt(assignee, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new ValidationError(`Invalid assignee ID: ${assignee}. Must be a positive number.`);
      }
      assigneeId = String(parsed);
    }

    const gitlab = new GitLabService(config.gitlab.host, config.gitlab.token);
    const mrs = await gitlab.listMergeRequests(projectId, {
      state,
      search,
      labels: labels.length > 0 ? labels : undefined,
      authorId,
      assigneeId,
    });

    return {
      success: true,
      data: mrs,
      message: `Found ${mrs.length} merge requests`,
      meta: {
        count: mrs.length,
      },
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --state <state>      Filter by state (opened/closed/merged)\n";
    help += "  --search <term>       Search in title/description\n";
    help += "  --labels <l1,l2>      Filter by labels\n";
    help += "  --author <id>        Filter by author ID\n";
    help += "  --assignee <id>       Filter by assignee ID\n";
    help += "  --project <id>       Project ID\n\n";
    help += "Example:\n";
    help += '  mr-rocket mr list --state opened --labels "bug"\n';
    return help;
  }
}
