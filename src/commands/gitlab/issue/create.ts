import { BaseCommand } from "../../base-command";
import type { ParsedArgs } from "../../../utils/cli-parser";
import type { CommandOutput } from "../../../types/command-output";
import { GitLabService } from "../../../services/gitlab.service";
import { configManager } from "../../../core/config-manager";
import { cliParser } from "../../../utils/cli-parser";
import { ValidationHelper, ValidationError } from "../../../utils/validation";

export class IssueCreateCommand extends BaseCommand {
  name = "issue create";
  description = "Create a new issue";
  override category = "GitLab";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = await configManager.load();
    const projectId = args.options.get("project") || config.gitlab.defaultProjectId;

    if (!projectId) {
      throw new ValidationError(
        "Project ID required. Provide via --project flag or config"
      );
    }

    const title = args.options.get("title");
    const description = args.options.get("description");
    const labels = cliParser.extractArray(args.options, "labels");

    ValidationHelper.validateIssueParams({
      title: title ?? "",
    });

    const gitlab = new GitLabService(config.gitlab.host, config.gitlab.token, config.gitlab.tls);
    const issue = await gitlab.createIssue(projectId, {
      title: title!,
      description: description || undefined,
      labels: labels.length > 0 ? labels : undefined,
    });

    return {
      success: true,
      data: issue,
      message: `Created issue #${issue.iid}: ${issue.title}`,
      meta: {
        webUrl: issue.webUrl,
        iid: issue.iid,
      },
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --title <title>       Issue title (required)\n";
    help += "  --description <text>  Issue description\n";
    help += "  --labels <l1,l2>      Comma-separated labels\n";
    help += "  --project <id>        Project ID\n\n";
    help += "Example:\n";
    help += '  mr-rocket issue create --title "Fix login bug" --labels "bug,critical"\n';
    return help;
  }
}
