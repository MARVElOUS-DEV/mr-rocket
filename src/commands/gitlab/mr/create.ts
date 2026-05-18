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
import { execFile } from "node:child_process";

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
  titleSource?: string;
  titleCommitSubjects?: string[];
  autoCommitHash?: string;
  autoCommitMessage?: string;
  wouldCommitCurrentChanges?: boolean;
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
      .use(async (ctx, next) => {
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
        ctx.source = ctx.args.options.get("source") || (await this.tryGetCurrentBranch());
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
        const explicitTitle = ctx.args.options.get("title")?.trim();
        if (explicitTitle) {
          ctx.title = explicitTitle;
          ctx.titleSource = "explicit";
        } else if (ctx.source && ctx.target) {
          const localTitle = await this.resolveTitleFromLocalGit(ctx);
          if (localTitle) {
            ctx.title = localTitle.title;
            ctx.titleSource = localTitle.source;
            ctx.titleCommitSubjects = localTitle.commitSubjects;
          } else {
            ctx.title = await ctx.gitlab.getLatestCommitTitle(ctx.projectId, ctx.source);
            ctx.titleSource = "gitlab-latest-commit-fallback";
          }
        } else {
          ctx.title = "";
        }

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
            titleSource: ctx.titleSource,
            titleCommitSubjects: ctx.titleCommitSubjects,
            autoCommitHash: ctx.autoCommitHash,
            autoCommitMessage: ctx.autoCommitMessage,
            wouldCommitCurrentChanges: ctx.wouldCommitCurrentChanges,
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
            titleSource: ctx.titleSource,
            autoCommitHash: ctx.autoCommitHash,
            autoCommitMessage: ctx.autoCommitMessage,
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
    help += "  --source <branch>     Source branch (default: current git branch)\n";
    help += "  --target <branch>     Target branch (default: master)\n";
    help += "  --title <title>       MR title (default: summarize target..source commits)\n";
    help += "  --description <text>  MR description (uploads local images)\n";
    help += "  --description-stdin   Read MR description from stdin (supports pasted images)\n";
    help += "  --labels <l1,l2>      Comma-separated labels\n";
    help += "  --assignee-id <id>    Assignee user ID (default: project config)\n";
    help += "  --reviewer-id <id>    Reviewer user ID (default: project config)\n";
    help += "  --reviewer-ids <ids>  Comma-separated reviewer user IDs\n";
    help += "  --project <id>        Project ID\n";
    help += "  --commit-message <m>  Commit message when auto-committing current changes\n";
    help += "  --no-commit-current   Do not auto-commit dirty working tree changes\n";
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

  private async resolveTitleFromLocalGit(
    ctx: MrCreateChainContext,
  ): Promise<
    | {
        title: string;
        source: string;
        commitSubjects: string[];
      }
    | undefined
  > {
    if (!ctx.source || !ctx.target) {
      return undefined;
    }

    if (!(await this.isInsideGitWorkTree())) {
      return undefined;
    }

    await this.commitCurrentChangesIfNeeded(ctx);

    const sourceRef = await this.resolveSourceRef(ctx.source);
    const targetRef = await this.resolveTargetRef(ctx.target);
    if (!sourceRef || !targetRef) {
      return undefined;
    }

    const commitSubjects = await this.getCommitSubjectsBetween(targetRef, sourceRef);
    if (ctx.wouldCommitCurrentChanges && ctx.autoCommitMessage) {
      commitSubjects.unshift(ctx.autoCommitMessage);
    }
    if (commitSubjects.length === 0) {
      return undefined;
    }

    return {
      title: this.buildTitleFromCommitSubjects(commitSubjects),
      source: `local-git:${targetRef}..${sourceRef}`,
      commitSubjects,
    };
  }

  private async commitCurrentChangesIfNeeded(
    ctx: MrCreateChainContext,
  ): Promise<void> {
    const status = await this.git(["status", "--porcelain"]);
    if (!status.stdout.trim()) {
      return;
    }

    const currentBranch = await this.tryGetCurrentBranch();
    if (!currentBranch || currentBranch !== ctx.source) {
      throw new ValidationError(
        "Working tree has uncommitted changes, but --source is not the checked-out branch. " +
          "Commit/stash the changes yourself or run mr create from the source branch.",
      );
    }

    if (ctx.args.flags.has("no-commit-current")) {
      throw new ValidationError(
        "Working tree has uncommitted changes. Commit/stash them, or omit --no-commit-current to let mr create commit them.",
      );
    }

    const message =
      ctx.args.options.get("commit-message") ||
      this.buildCommitMessageFromBranch(ctx.source ?? currentBranch);

    if (ctx.dryRun) {
      ctx.wouldCommitCurrentChanges = true;
      ctx.autoCommitMessage = message;
      return;
    }

    await this.git(["add", "-A"]);
    const cachedDiff = await this.git(["diff", "--cached", "--quiet"], [0, 1]);
    if (cachedDiff.exitCode === 0) {
      return;
    }

    await this.git(["commit", "-m", message]);
    const hash = await this.git(["rev-parse", "--short", "HEAD"]);
    ctx.autoCommitHash = hash.stdout.trim();
    ctx.autoCommitMessage = message;
  }

  private async getCommitSubjectsBetween(
    targetRef: string,
    sourceRef: string,
  ): Promise<string[]> {
    const withoutMerges = await this.git(
      ["log", "--format=%s", "--no-merges", `${targetRef}..${sourceRef}`],
      [0],
    );
    const subjects = this.parseCommitSubjects(withoutMerges.stdout);
    if (subjects.length > 0) {
      return subjects;
    }

    const withMerges = await this.git(
      ["log", "--format=%s", `${targetRef}..${sourceRef}`],
      [0],
    );
    return this.parseCommitSubjects(withMerges.stdout);
  }

  private parseCommitSubjects(output: string): string[] {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private buildTitleFromCommitSubjects(subjects: string[]): string {
    const normalized = subjects.map((subject) => this.normalizeCommitSubject(subject));
    const first = normalized[0] ?? "";
    if (normalized.length <= 1) {
      return this.truncateTitle(first);
    }

    const parsed = normalized.map((subject) => this.parseConventionalCommit(subject));
    const firstParsed = parsed[0];
    const sameType =
      firstParsed?.type &&
      parsed.every((item) => item?.type === firstParsed.type);
    const sameScope =
      firstParsed?.scope &&
      parsed.every((item) => item?.scope === firstParsed.scope);

    if (firstParsed?.description && sameType) {
      const prefix = sameScope
        ? `${firstParsed.type}(${firstParsed.scope}):`
        : `${firstParsed.type}:`;
      return this.truncateTitle(
        `${prefix} ${firstParsed.description} (+${normalized.length - 1} commits)`,
      );
    }

    return this.truncateTitle(`${first} (+${normalized.length - 1} commits)`);
  }

  private parseConventionalCommit(
    subject: string,
  ): { type: string; scope?: string; description: string } | undefined {
    const match = /^([a-z]+)(?:\(([^)]+)\))?!?:\s+(.+)$/.exec(subject);
    if (!match) {
      return undefined;
    }
    return {
      type: match[1] ?? "",
      scope: match[2],
      description: match[3] ?? "",
    };
  }

  private normalizeCommitSubject(subject: string): string {
    return subject
      .replace(/^WIP:\s*/i, "")
      .replace(/^draft:\s*/i, "")
      .trim();
  }

  private truncateTitle(title: string): string {
    const trimmed = title.trim();
    if (trimmed.length <= 120) {
      return trimmed;
    }
    return `${trimmed.slice(0, 117).trimEnd()}...`;
  }

  private buildCommitMessageFromBranch(branch: string): string {
    const cleaned = branch
      .split("/")
      .at(-1)
      ?.replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const summary = cleaned && cleaned.length > 0 ? cleaned : branch;
    const lowerBranch = branch.toLowerCase();
    const type = lowerBranch.includes("fix") || lowerBranch.includes("bug")
      ? "fix"
      : lowerBranch.includes("feature") || lowerBranch.includes("feat")
        ? "feat"
        : "chore";
    return this.truncateTitle(`${type}: ${summary}`);
  }

  private async resolveSourceRef(source: string): Promise<string | undefined> {
    if (await this.refExists(source)) {
      return source;
    }
    const currentBranch = await this.tryGetCurrentBranch();
    if (currentBranch === source && (await this.refExists("HEAD"))) {
      return "HEAD";
    }
    return undefined;
  }

  private async resolveTargetRef(target: string): Promise<string | undefined> {
    const candidates = [target, `origin/${target}`, `upstream/${target}`];
    for (const candidate of candidates) {
      if (await this.refExists(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private async refExists(ref: string): Promise<boolean> {
    const result = await this.git(["rev-parse", "--verify", `${ref}^{commit}`], [0, 1]);
    return result.exitCode === 0;
  }

  private async tryGetCurrentBranch(): Promise<string | undefined> {
    try {
      const result = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = result.stdout.trim();
      return branch && branch !== "HEAD" ? branch : undefined;
    } catch {
      return undefined;
    }
  }

  private async isInsideGitWorkTree(): Promise<boolean> {
    const result = await this.git(["rev-parse", "--is-inside-work-tree"], [0, 1]);
    return result.exitCode === 0 && result.stdout.trim() === "true";
  }

  private async git(
    args: string[],
    allowedExitCodes: number[] = [0],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return await new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 10 },
        (error, stdout, stderr) => {
          const errorCode = error?.code;
          const exitCode = typeof errorCode === "number" ? errorCode : 0;

          if (error && !allowedExitCodes.includes(exitCode)) {
            reject(new Error(String(stderr || error.message)));
            return;
          }

          resolve({
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            exitCode,
          });
        },
      );
    });
  }
}
