import { BaseCommand } from "../../base-command";
import type { ParsedArgs } from "../../../utils/cli-parser";
import type { CommandOutput } from "../../../models/command-output";
import { GitLabService } from "../../../services/gitlab.service";
import { configManager } from "../../../core/config-manager";
import { cliParser } from "../../../utils/cli-parser";
import { ValidationHelper, ValidationError } from "../../../utils/validation";

export class MrCreateCommand extends BaseCommand {
  name = "mr create";
  description = "Create a new merge request";
  override category = "GitLab";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = await configManager.load();
    const projectId = args.options.get("project") || config.gitlab.defaultProjectId;

    if (!projectId) {
      throw new ValidationError(
        "Project ID required. Provide via --project flag or config"
      );
    }

    const source = args.options.get("source");
    const target = args.options.get("target") || config.gitlab.defaultBranch || "main";
    const title = args.options.get("title");
    const description = args.options.get("description");
    const labels = cliParser.extractArray(args.options, "labels");

    ValidationHelper.validateMRParams({
      sourceBranch: source ?? "",
      targetBranch: target ?? "",
      title: title ?? "",
    });

    const gitlab = new GitLabService(config.gitlab.host, config.gitlab.token, config.gitlab.tls);
    const mr = await gitlab.createMergeRequest(projectId, {
      sourceBranch: source!,
      targetBranch: target!,
      title: title!,
      description: description || undefined,
      labels: labels.length > 0 ? labels : undefined,
    });

    return {
      success: true,
      data: mr,
      message: `Created MR !${mr.iid}: ${mr.title}`,
      meta: {
        webUrl: mr.webUrl,
        iid: mr.iid,
      },
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --source <branch>     Source branch (required)\n";
    help += "  --target <branch>     Target branch (default: main)\n";
    help += "  --title <title>       MR title (required)\n";
    help += "  --description <text>  MR description\n";
    help += "  --labels <l1,l2>      Comma-separated labels\n";
    help += "  --project <id>        Project ID\n\n";
    help += "Example:\n";
    help += '  mr-rocket mr create --source feature/new --target main --title "Fix bug"\n';
    return help;
  }
}
