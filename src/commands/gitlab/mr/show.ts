import { BaseCommand } from "../../base-command";
import type { ParsedArgs } from "../../../utils/cli-parser";
import type { CommandOutput } from "../../../models/command-output";
import { GitLabService } from "../../../services/gitlab.service";
import { configManager } from "../../../core/config-manager";
import { ValidationHelper, ValidationError } from "../../../utils/validation";

export class MrShowCommand extends BaseCommand {
  name = "mr show";
  description = "Show merge request details";
  override category = "GitLab";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const config = await configManager.load();
    const projectId = args.options.get("project") || config.gitlab.defaultProjectId;

    if (!projectId) {
      throw new ValidationError(
        "Project ID required. Provide via --project flag or config"
      );
    }

    if (!args.positional[0]) {
      throw new ValidationError("MR IID is required as a positional argument");
    }

    const mrIid = ValidationHelper.validateMRId(args.positional[0]);

    const gitlab = new GitLabService(config.gitlab.host, config.gitlab.token, config.gitlab.tls);
    const mr = await gitlab.showMergeRequest(projectId, mrIid);

    return {
      success: true,
      data: mr,
      message: `MR !${mr.iid}: ${mr.title}`,
      meta: {
        webUrl: mr.webUrl,
        iid: mr.iid,
        state: mr.state,
      },
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Usage:\n";
    help += "  mr-rocket mr show <mr-iid> [options]\n\n";
    help += "Options:\n";
    help += "  --project <id>        Project ID\n\n";
    help += "Example:\n";
    help += "  mr-rocket mr show 45\n";
    return help;
  }
}
