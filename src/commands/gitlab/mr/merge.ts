import { BaseCommand } from "../../base-command";
import type { ParsedArgs } from "../../../utils/cli-parser";
import type { CommandOutput } from "../../../types/command-output";
import { GitLabService } from "../../../services/gitlab.service";
import { configManager } from "../../../core/config-manager";
import { ValidationHelper, ValidationError } from "../../../utils/validation";

export class MrMergeCommand extends BaseCommand {
  name = "mr merge";
  description = "Merge a merge request";
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
    const squash = args.flags.has("squash");
    const removeSource = args.flags.has("remove-source");

    const gitlab = new GitLabService(config.gitlab.host, config.gitlab.token, config.gitlab.tls);
    await gitlab.mergeMergeRequest(projectId, mrIid, {
      squash: squash || undefined,
      removeSourceBranch: removeSource || undefined,
    });

    return {
      success: true,
      message: `Merged MR !${mrIid}`,
      meta: {
        mrIid,
        projectId,
        squash,
        removeSource,
      },
    };
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Usage:\n";
    help += "  mr-rocket mr merge <mr-iid> [options]\n\n";
    help += "Options:\n";
    help += "  --squash              Squash commits on merge\n";
    help += "  --remove-source        Remove source branch after merge\n";
    help += "  --project <id>        Project ID\n\n";
    help += "Example:\n";
    help += "  mr-rocket mr merge 45 --squash --remove-source\n";
    return help;
  }
}
