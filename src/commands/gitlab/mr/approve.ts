import { BaseCommand } from "../../base-command";
import type { ParsedArgs } from "../../../utils/cli-parser";
import type { CommandOutput } from "../../../types/command-output";
import { GitLabService } from "../../../services/gitlab.service";
import { configManager } from "../../../core/config-manager";
import { ValidationHelper, ValidationError } from "../../../utils/validation";

export class MrApproveCommand extends BaseCommand {
  name = "mr approve";
  description = "Approve a merge request";
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
    const message = args.options.get("message");

    const gitlab = new GitLabService(config.gitlab.host, config.gitlab.token, config.gitlab.tls);
    await gitlab.approveMergeRequest(projectId, mrIid, message);

    return {
      success: true,
      message: `Approved MR !${mrIid}`,
      meta: {
        mrIid,
        projectId,
      },
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Usage:\n";
    help += "  mr-rocket mr approve <mr-iid> [options]\n\n";
    help += "Options:\n";
    help += "  --message <text>      Approval message\n";
    help += "  --project <id>        Project ID\n\n";
    help += "Example:\n";
    help += "  mr-rocket mr approve 45 --message 'LGTM'\n";
    return help;
  }
}
