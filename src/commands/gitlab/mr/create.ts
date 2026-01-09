import { BaseCommand } from "../../base-command.ts";
import type { ParsedArgs } from "../../../utils/cli-parser.ts";
import type { CommandOutput } from "../../../models/command-output.ts";
import type { AppConfig } from "../../../models/config.ts";
import type { MergeRequest } from "../../../models/gitlab.ts";
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
import { buildErrorOutput } from "../../../core/command-output-helpers.ts";
import { ValidationHelper, ValidationError } from "../../../utils/validation.ts";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

type MrCreateChainContext = {
  args: ParsedArgs;
  config?: AppConfig;
  projectId?: string;
  source?: string;
  target?: string;
  title?: string;
  description?: string;
  labels?: string[];
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
    const context: MrCreateChainContext = { args };

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
        ctx.projectId = String(projectId);
        ctx.source = ctx.args.options.get("source");
        ctx.target =
          ctx.args.options.get("target") || ctx.config?.gitlab.defaultBranch || "master";
        ctx.description = ctx.args.options.get("description");
        ctx.labels = cliParser.extractArray(ctx.args.options, "labels");

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

        if (ctx.description) {
          ctx.preparedDescription = await this.replaceLocalImagesWithUploads(
            ctx.gitlab,
            ctx.projectId,
            ctx.description
          );
        }

        return next();
      })
      .use(async (ctx, next) => {
        if (!ctx.gitlab || !ctx.projectId || !ctx.source || !ctx.target || !ctx.title) {
          throw new Error("Missing required MR parameters");
        }
        ctx.mr = await ctx.gitlab.createMergeRequest(ctx.projectId, {
          sourceBranch: ctx.source,
          targetBranch: ctx.target,
          title: ctx.title,
          description: ctx.preparedDescription,
          labels: ctx.labels && ctx.labels.length > 0 ? ctx.labels : undefined,
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
    help += "  --labels <l1,l2>      Comma-separated labels\n";
    help += "  --project <id>        Project ID\n\n";
    help += "Example:\n";
    help += '  mr-rocket mr create --source feature/new --target master --title "Fix bug"\n';
    return help;
  }

  private async replaceLocalImagesWithUploads(
    gitlab: GitLabService,
    projectId: number | string,
    description: string
  ): Promise<string> {
    const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    const matches = Array.from(description.matchAll(imageRegex));
    if (matches.length === 0) {
      return description;
    }

    const uploadCache = new Map<string, string>();
    let updated = description;

    for (const match of matches) {
      const fullMatch = match[0];
      const altText = match[1] ?? "";
      const imagePath = match[2] ?? "";

      if (this.isRemoteImageReference(imagePath)) {
        continue;
      }

      const resolvedPath = isAbsolute(imagePath)
        ? imagePath
        : resolve(process.cwd(), imagePath);

      if (!existsSync(resolvedPath)) {
        throw new ValidationError(`Image file not found: ${resolvedPath}`);
      }

      const cachedUrl = uploadCache.get(resolvedPath);
      const uploadUrl =
        cachedUrl ?? (await gitlab.uploadProjectFile(projectId, resolvedPath)).url;

      uploadCache.set(resolvedPath, uploadUrl);
      const replacement = `![${altText}](${uploadUrl})`;
      updated = updated.replaceAll(fullMatch, replacement);
    }

    return updated;
  }

  private isRemoteImageReference(pathValue: string): boolean {
    const trimmed = pathValue.trim();
    return (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("/uploads/") ||
      trimmed.startsWith("/-/uploads/")
    );
  }
}
