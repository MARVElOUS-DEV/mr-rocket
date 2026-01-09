import { BaseCommand } from "../../base-command.ts";
import type { ParsedArgs } from "../../../utils/cli-parser.ts";
import type { CommandOutput } from "../../../models/command-output.ts";
import type { AppConfig } from "../../../models/config.ts";
import type { MRFilter, MergeRequest } from "../../../models/gitlab.ts";
import type { GitLabService } from "../../../services/gitlab.service.ts";
import type { SystemService } from "../../../services/system.service.ts";
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
import { buildErrorOutput } from "../../../core/command-output-helpers.ts";
import { ValidationError } from "../../../utils/validation.ts";

type MrListChainContext = {
  args: ParsedArgs;
  config?: AppConfig;
  projectId?: string;
  filter?: MRFilter;
  gitlab?: GitLabService;
  system?: SystemService;
  mrs?: MergeRequest[];
  output?: CommandOutput;
};

export class MrListCommand extends BaseCommand {
  name = "mr list";
  description = "List merge requests";
  override category = "GitLab";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const context: MrListChainContext = { args };

    const chain = new ServiceChain<MrListChainContext>()
      .use(withSystemService())
      .use(
        withOutputError((ctx, error) =>
          buildErrorOutput(error, "Failed to list merge requests")
        )
      )
      .use(
        withErrorBoundary(async (ctx, error) => {
          if (ctx.system) {
            try {
              await ctx.system.appendCommandLog(`mr list error=${error.message}`);
            } catch {
              // Ignore logging failures.
            }
          }
        })
      )
      .use(withConfig(() => configManager.load()))
      .use(async (ctx, next) => {
        const projectId = ctx.args.options.get("project") || ctx.config?.gitlab.defaultProjectId;
        if (!projectId) {
          throw new ValidationError(
            "Project ID required. Provide via --project flag or config"
          );
        }
        ctx.projectId = String(projectId);
        await next();
      })
      .use((ctx, next) => {
        const state = ctx.args.options.get("state") as "opened" | "closed" | "merged" | undefined;
        const search = ctx.args.options.get("search");
        const labels = cliParser.extractArray(ctx.args.options, "labels");
        const author = ctx.args.options.get("author");
        const assignee = ctx.args.options.get("assignee");

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

        ctx.filter = {
          state,
          search,
          labels: labels.length > 0 ? labels : undefined,
          authorId,
          assigneeId,
        };

        return next();
      })
      .use(withGitLabService())
      .use(async (ctx, next) => {
        if (!ctx.gitlab || !ctx.projectId) {
          throw new Error("Missing GitLab context for request");
        }
        ctx.mrs = await ctx.gitlab.listMergeRequests(ctx.projectId, ctx.filter ?? {});
        return next();
      })
      .use(
        withTiming("mr list", async (ctx, durationMs) => {
          if (ctx.system) {
            try {
              await ctx.system.appendCommandLog(`mr list durationMs=${durationMs}`);
            } catch {
              // Ignore logging failures.
            }
          }
        })
      )
      .use(async (ctx, next) => {
        if (ctx.system) {
          try {
            const count = ctx.mrs?.length ?? 0;
            await ctx.system.appendCommandLog(`mr list count=${count}`);
          } catch {
            // Non-critical audit log failure should not block command output.
          }
        }
        return next();
      })
      .use(withOutput((ctx) => {
        const mrs = ctx.mrs ?? [];
        return {
          success: true,
          data: mrs,
          message: `Found ${mrs.length} merge requests`,
          meta: {
            count: mrs.length,
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
