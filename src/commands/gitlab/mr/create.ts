import { BaseCommand } from "../../base-command.ts";
import type { ParsedArgs } from "../../../utils/cli-parser.ts";
import type { CommandOutput } from "../../../types/command-output.ts";
import type { AppConfig } from "../../../types/config.ts";
import type { MergeRequest } from "../../../types/gitlab.ts";
import type { GitLabService } from "../../../services/gitlab.service.ts";
import type { SystemService } from "../../../services/system.service.ts";
import { GitLabService as GitLabServiceClass } from "../../../services/gitlab.service.ts";
import { configManager } from "../../../core/config-manager.ts";
import { cliParser } from "../../../utils/cli-parser.ts";
import { ServiceChain } from "../../../core/service-chain.ts";
import {
  withConfig,
  withGitLabService,
  withSystemService,
  withTiming,
  withErrorBoundary,
  withOutput,
  withOutputError,
} from "../../../core/service-chain-steps.ts";
import { buildErrorOutput } from "../../../utils/command-output-helpers.ts";
import { ValidationHelper, ValidationError } from "../../../utils/validation.ts";
import { prepareDescriptionWithUploads } from "../../../utils/description-images.ts";

type MrCreateChainContext = {
  args: ParsedArgs;
  stdinDescription?: string;
  dryRun?: boolean;
  config?: AppConfig;
  projectId?: string;
  source?: string;
  target?: string;
  title?: string;
  description?: string;
  labels?: string[];
  assigneeId?: number;
  reviewerId?: number;
  reviewerIds?: number[];
  gitlab?: GitLabService;
  system?: SystemService;
  preparedDescription?: string;
  mr?: MergeRequest;
  output?: CommandOutput;
};

export class MrCreateCommand extends BaseCommand {
  name = "mr create";
  description = "Create a new merge request";
  override category = "GitLab";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const stdinDescription =
      args.flags.has("description-stdin") && !args.options.get("description")
        ? await this.readDescriptionFromStdin(args.json)
        : undefined;
    const dryRun = args.flags.has("dry-run");
    const context: MrCreateChainContext = { args, stdinDescription, dryRun };

    const chain = new ServiceChain<MrCreateChainContext>()
      .use(withSystemService())
      .use(
        withOutputError((ctx, error) =>
          buildErrorOutput(error, "Failed to create merge request")
        )
      )
      .use(
        withErrorBoundary(async (ctx, error) => {
          if (ctx.system) {
            try {
              await ctx.system.appendCommandLog(`mr create error=${error.message}`);
            } catch {
              // Ignore logging failures.
            }
          }
        })
      )
      .use(
        withTiming("mr create", async (ctx, durationMs) => {
          if (ctx.system) {
            try {
              await ctx.system.appendCommandLog(`mr create durationMs=${durationMs}`);
            } catch {
              // Ignore logging failures.
            }
          }
        })
      )
      .use(withConfig(() => configManager.load()))
      .use((ctx, next) => {
        const projectId = ctx.args.options.get("project") || ctx.config?.gitlab.defaultProjectId;
        if (!projectId) {
          throw new ValidationError(
            "Project ID required. Provide via --project flag or config"
          );
        }

        const projectDefaults = ctx.config?.gitlab.projects?.find(
          (p) => String(p.id) === String(projectId)
        );

        const parseNumber = (value?: string): number | undefined => {
          if (!value) {
            return undefined;
          }
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : undefined;
        };

        ctx.projectId = String(projectId);
        ctx.source = ctx.args.options.get("source");
        ctx.target =
          ctx.args.options.get("target") || ctx.config?.gitlab.defaultBranch || "master";
        ctx.description = ctx.args.options.get("description") ?? ctx.stdinDescription;
        ctx.labels = cliParser.extractArray(ctx.args.options, "labels");

        ctx.assigneeId =
          parseNumber(ctx.args.options.get("assignee-id")) ?? projectDefaults?.assigneeId;
        ctx.reviewerId =
          parseNumber(ctx.args.options.get("reviewer-id")) ?? projectDefaults?.reviewerId;

        const reviewerIds = cliParser
          .extractArray(ctx.args.options, "reviewer-ids")
          .map((id) => parseNumber(id))
          .filter((id): id is number => typeof id === "number");
        ctx.reviewerIds = reviewerIds.length > 0 ? reviewerIds : undefined;

        ValidationHelper.required(ctx.source, "sourceBranch");
        return next();
      })
      .use(withGitLabService((config) => new GitLabServiceClass(
        config.gitlab.host,
        config.gitlab.token,
        config.gitlab.tls
      )))
      .use(async (ctx, next) => {
        if (!ctx.gitlab || !ctx.projectId) {
          throw new Error("Missing GitLab context for request");
        }
        ctx.title =
          ctx.args.options.get("title") ||
          (ctx.source ? await ctx.gitlab.getLatestCommitTitle(ctx.projectId, ctx.source) : "");

        ValidationHelper.validateMRParams({
          sourceBranch: ctx.source ?? "",
          targetBranch: ctx.target ?? "",
          title: ctx.title ?? "",
        });

        // Skip description upload in dry-run mode
        if (ctx.description && !ctx.dryRun) {
          ctx.preparedDescription = await prepareDescriptionWithUploads(
            ctx.gitlab,
            ctx.projectId,
            ctx.description
          );
        }

        return next();
      })
      .use(async (ctx, next) => {
        // Skip actual MR creation in dry-run mode
        if (ctx.dryRun) {
          return next();
        }
        if (!ctx.gitlab || !ctx.projectId || !ctx.source || !ctx.target || !ctx.title) {
          throw new Error("Missing required MR parameters");
        }
        ctx.mr = await ctx.gitlab.createMergeRequest(ctx.projectId, {
          sourceBranch: ctx.source,
          targetBranch: ctx.target,
          title: ctx.title,
          description: ctx.preparedDescription,
          labels: ctx.labels && ctx.labels.length > 0 ? ctx.labels : undefined,
          assigneeId: ctx.assigneeId,
          reviewerId: ctx.reviewerId,
          reviewerIds: ctx.reviewerIds,
        });
        return next();
      })
      .use(async (ctx, next) => {
        if (ctx.system && ctx.mr) {
          try {
            await ctx.system.appendCommandLog(`mr create iid=${ctx.mr.iid}`);
          } catch {
            // Ignore logging failures.
          }
        }
        return next();
      })
      .use(withOutput((ctx) => {
        // Handle dry-run output
        if (ctx.dryRun) {
          const dryRunData = {
            projectId: ctx.projectId,
            sourceBranch: ctx.source,
            targetBranch: ctx.target,
            title: ctx.title,
            description: ctx.description ? "(description provided)" : undefined,
            labels: ctx.labels,
            assigneeId: ctx.assigneeId,
            reviewerId: ctx.reviewerId,
            reviewerIds: ctx.reviewerIds,
          };
          return {
            success: true,
            data: dryRunData,
            message: `[DRY-RUN] Would create MR: ${ctx.title}`,
            meta: {
              dryRun: true,
              sourceBranch: ctx.source,
              targetBranch: ctx.target,
            },
          };
        }

        const mr = ctx.mr;
        if (!mr) {
          throw new Error("Merge request was not created");
        }
        return {
          success: true,
          data: mr,
          message: `Created MR !${mr.iid}: ${mr.title}`,
          meta: {
            webUrl: mr.webUrl,
            iid: mr.iid,
          },
        };
      }));

    await chain.run(context);

    return (
      context.output ?? {
        success: false,
        message: "Service chain did not produce output",
        error: new Error("Service chain did not produce output"),
      }
    );
  }

  override printHelp(): string {
    let help = super.printHelp();
    help += "Options:\n";
    help += "  --source <branch>     Source branch (required)\n";
    help += "  --target <branch>     Target branch (default: master)\n";
    help += "  --title <title>       MR title (default: latest commit title)\n";
    help += "  --description <text>  MR description (uploads local images)\n";
    help += "  --description-stdin   Read MR description from stdin (supports pasted images)\n";
    help += "  --labels <l1,l2>      Comma-separated labels\n";
    help += "  --assignee-id <id>    Assignee user ID (default: project config)\n";
    help += "  --reviewer-id <id>    Reviewer user ID (default: project config)\n";
    help += "  --reviewer-ids <ids>  Comma-separated reviewer user IDs\n";
    help += "  --project <id>        Project ID\n";
    help += "  --dry-run             Validate parameters without creating MR\n\n";
    help += "Example:\n";
    help += '  mr-rocket mr create --source feature/new --target master --title "Fix bug"\n';
    help += '  mr-rocket mr create --source feature/new --dry-run  # Validate only\n';
    return help;
  }

  private async readDescriptionFromStdin(jsonMode: boolean): Promise<string> {
    if (process.stdin.isTTY) {
      const hint = "Paste or type the MR description, then press Ctrl+D to finish.\n";
      if (jsonMode) {
        process.stderr.write(hint);
      } else {
        process.stdout.write(hint);
      }
    }

    return await new Promise((resolve, reject) => {
      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
      });
      process.stdin.on("end", () => {
        resolve(buffer.trimEnd());
      });
      process.stdin.on("error", reject);
    });
  }
}
