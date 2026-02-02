import { BaseCommand } from "../base-command.ts";
import type { ParsedArgs } from "../../utils/cli-parser.ts";
import type { CommandOutput, TableOutput } from "../../types/command-output.ts";
import type { AppConfig, GitLabProject } from "../../types/config.ts";
import type { MergeRequest } from "../../types/gitlab.ts";
import type { GitLabService } from "../../services/gitlab.service.ts";
import type { SystemService } from "../../services/system.service.ts";
import { configManager } from "../../core/config-manager.ts";
import { cliParser } from "../../utils/cli-parser.ts";
import { ServiceChain } from "../../core/service-chain.ts";
import {
  withConfig,
  withCdpService,
  withErrorBoundary,
  withGitLabService,
  withOutput,
  withOutputError,
  withSystemService,
  withTiming,
} from "../../core/service-chain-steps.ts";
import { buildErrorOutput } from "../../utils/command-output-helpers.ts";
import { ValidationError, ValidationHelper } from "../../utils/validation.ts";
import {
  prepareDescriptionWithUploads,
  prepareMrDescriptionFromTemplate,
  DESCRIPTION_TEMPLATE,
} from "../../utils/description-images.ts";
import { CDPService } from "../../services/cdp.service.ts";
import type { BugMetadata } from "../../services/cdp.service.ts";
import { listBugImagePaths } from "../../utils/bug-image-store.ts";
import { warning } from "../../utils/colors.ts";
import { execFile } from "node:child_process";

type CommentInput = {
  reason: string;
  solution: string;
};

type GitProjectRef = {
  host: string;
  pathWithNamespace: string;
  repoName: string;
};

type MrxChainContext = {
  args: ParsedArgs;
  config?: AppConfig;
  gitlab?: GitLabService;
  cdp?: CDPService;
  gitProject?: GitProjectRef;

  // MR inputs
  projectId?: string;
  source?: string;
  target?: string;
  title?: string;
  description?: string;
  labels?: string[];
  assigneeId?: number;
  reviewerId?: number;
  reviewerIds?: number[];
  dryRun?: boolean;
  preparedDescription?: string;
  utScreenshots?: string;
  e2eScreenshots?: string;

  // CDP comment inputs
  bugId?: string;
  commentInput?: CommentInput;
  includeLocalImages?: boolean;
  cdpBug?: BugMetadata;

  // Outputs
  mr?: MergeRequest;
  commentBug?: BugMetadata;
  commentCreated?: boolean;
  commentError?: string;
  output?: CommandOutput;
  system?: SystemService;
};

export class MrxCommand extends BaseCommand {
  name = "mrx";
  description =
    "Create a merge request and add a CDP bug comment in one command";
  override category = "Workflow";

  override async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const context: MrxChainContext = { args };

    const chain = new ServiceChain<MrxChainContext>()
      .use(withSystemService())
      .use(withOutputError((ctx, error) => buildErrorOutput(error)))
      .use(
        withErrorBoundary(async (ctx, error) => {
          if (ctx.system) {
            try {
              await ctx.system.appendCommandLog(`mrx error=${error.message}`);
            } catch {
              // Ignore logging failures.
            }
          }
        }),
      )
      .use(
        withTiming("mrx", async (ctx, durationMs) => {
          if (ctx.system) {
            try {
              await ctx.system.appendCommandLog(`mrx durationMs=${durationMs}`);
            } catch {
              // Ignore logging failures.
            }
          }
        }),
      )
      .use(withConfig(() => configManager.load()))
      .use(withCdpService(undefined, { required: false }))
      .use(async (ctx, next) => {
        ctx.dryRun = ctx.args.flags.has("dry-run");
        ctx.includeLocalImages = !ctx.args.flags.has("no-local-images");

        ctx.bugId = await this.resolveBugId(ctx.args);
        ctx.projectId = await this.resolveProjectId(ctx);

        const projectDefaults = this.resolveProjectDefaults(ctx);
        ctx.utScreenshots = projectDefaults?.ut;
        ctx.e2eScreenshots = projectDefaults?.e2e;
        ctx.assigneeId =
          this.parseNumberOption(ctx.args.options.get("assignee-id")) ??
          projectDefaults?.assigneeId;
        ctx.reviewerId =
          this.parseNumberOption(ctx.args.options.get("reviewer-id")) ??
          projectDefaults?.reviewerId;
        ctx.reviewerIds = this.resolveReviewerIds(ctx);

        ctx.source = ctx.args.options.get("source")?.trim();
        if (!ctx.source) {
          ctx.source = await this.inferGitBranch();
        }
        ctx.target =
          ctx.args.options.get("target") ||
          ctx.config?.gitlab.defaultBranch ||
          "master";
        ctx.description = ctx.args.options.get("description");
        ctx.labels = cliParser.extractArray(ctx.args.options, "labels");

        ValidationHelper.required(ctx.source, "sourceBranch");

        if (ctx.args.flags.has("description-stdin")) {
          throw new ValidationError(
            "mrx does not support --description-stdin. Use --description <text>.",
          );
        }

        ctx.commentInput = await this.resolveCommentInput(ctx.args);

        return next();
      })
      .use(withGitLabService())
      .use(async (ctx, next) => {
        if (!ctx.dryRun && ctx.cdp && ctx.bugId) {
          try {
            const {
              data: { fieldMap: bug },
            } = await ctx.cdp.getBug(ctx.bugId);
            ctx.cdpBug = bug;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.emitWarning(
              ctx,
              `CDP bug lookup failed (will continue): ${error.message}`,
            );
          }
        }

        if (!ctx.gitlab || !ctx.projectId) {
          throw new Error("Missing GitLab context for request");
        }

        const bugId = ctx.bugId;
        if (!bugId) {
          throw new Error("Missing bug id for mrx");
        }

        const explicitTitle = ctx.args.options.get("title")?.trim();

        if (explicitTitle) {
          ctx.title = explicitTitle;
        } else if (ctx.cdpBug?.title) {
          ctx.title = `bug ${bugId}: ${ctx.cdpBug.title}`;
        } else {
          ctx.title = `bug ${bugId}:`;
        }

        ValidationHelper.validateMRParams({
          sourceBranch: ctx.source ?? "",
          targetBranch: ctx.target ?? "",
          title: ctx.title ?? "",
        });

        const rawDescription = this.resolveRawDescription(ctx.description);
        const hasTemplatePlaceholders =
          rawDescription.includes("{{cdpLink}}") ||
          rawDescription.includes("{{selfTestResults}}") ||
          rawDescription.includes("{{utScreenshots}}") ||
          rawDescription.includes("{{e2eScreenshots}}") ||
          rawDescription.includes("{{solution}}") ||
          rawDescription.includes("{{backendDependency}}");

        if (!ctx.dryRun) {
          ctx.preparedDescription = hasTemplatePlaceholders
            ? await prepareMrDescriptionFromTemplate({
                gitlab: ctx.gitlab,
                projectId: ctx.projectId,
                template: rawDescription,
                bugId,
                cdpHost: ctx.config?.cdp?.host,
                cdpProductGroupId: ctx.cdpBug?.product_id,
                cdpItemId: ctx.cdpBug?.index_code,
                utScreenshots: ctx.utScreenshots,
                e2eScreenshots: ctx.e2eScreenshots,
                solution: ctx.commentInput?.solution,
              })
            : rawDescription.trim().length > 0
              ? await prepareDescriptionWithUploads(
                  ctx.gitlab,
                  ctx.projectId,
                  rawDescription.trim(),
                )
              : undefined;
        }

        return next();
      })
      .use(async (ctx, next) => {
        if (ctx.dryRun) {
          return next();
        }

        if (
          !ctx.gitlab ||
          !ctx.projectId ||
          !ctx.source ||
          !ctx.target ||
          !ctx.title
        ) {
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

        if (ctx.system) {
          try {
            await ctx.system.appendCommandLog(`mrx mrIid=${ctx.mr.iid}`);
          } catch {
            // Ignore logging failures.
          }
        }

        return next();
      })
      .use(async (ctx, next) => {
        if (ctx.dryRun) {
          ctx.commentCreated = false;
          return next();
        }

        if (!ctx.cdp) {
          ctx.commentCreated = false;
          ctx.commentError = "CDP is not configured";
          this.emitWarning(ctx, `CDP comment skipped: ${ctx.commentError}`);
          return next();
        }

        if (!ctx.mr) {
          // This should not happen if dryRun is false.
          ctx.commentCreated = false;
          ctx.commentError = "MR was not created; cannot post CDP comment";
          this.emitWarning(ctx, `CDP comment skipped: ${ctx.commentError}`);
          return next();
        }

        const bugId = ctx.bugId;
        const commentInput = ctx.commentInput;
        if (!bugId || !commentInput) {
          ctx.commentCreated = false;
          ctx.commentError = "Missing CDP comment inputs";
          this.emitWarning(ctx, `CDP comment skipped: ${ctx.commentError}`);
          return next();
        }

        try {
          const bug = ctx.cdpBug ?? (await ctx.cdp.getBug(bugId)).data.fieldMap;
          ctx.commentBug = bug;

          const uploadedLocalUrls: string[] = [];
          if (ctx.includeLocalImages) {
            const localImagePaths = listBugImagePaths(bugId);
            for (const filePath of localImagePaths) {
              const url = await ctx.cdp.uploadAttachment(filePath);
              if (url) {
                uploadedLocalUrls.push(url);
              }
            }
          }

          await ctx.cdp.createComment(
            bug,
            commentInput.reason,
            commentInput.solution,
            uploadedLocalUrls,
            ctx.mr.webUrl,
          );

          ctx.commentCreated = true;
          return next();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          ctx.commentCreated = false;
          ctx.commentError = error.message;
          this.emitWarning(ctx, `CDP comment failed: ${error.message}`);
          return next();
        }
      })
      .use(
        withOutput((ctx) => {
          // DRY-RUN output
          if (ctx.dryRun) {
            return {
              success: true,
              data: {
                dryRun: true,
                projectId: ctx.projectId,
                sourceBranch: ctx.source,
                targetBranch: ctx.target,
                title: ctx.title,
                description: ctx.description
                  ? "(description provided)"
                  : undefined,
                labels: ctx.labels,
                bugId: ctx.bugId,
                comment: "(would post reason/solution)",
                includeLocalImages: ctx.includeLocalImages,
              },
              message: `[DRY-RUN] Would create MR and comment CDP bug ${ctx.bugId}`,
              meta: {
                dryRun: true,
              },
            };
          }

          const mr = ctx.mr;
          if (!mr) {
            throw new Error("Merge request was not created");
          }

          const commentOk = ctx.commentCreated === true;
          const commentStatus = commentOk
            ? "created"
            : ctx.commentError
              ? `failed: ${ctx.commentError}`
              : "skipped";

          if (ctx.args.json) {
            return {
              success: true,
              data: {
                mr,
                bugId: ctx.bugId,
                comment: {
                  success: commentOk,
                  error: ctx.commentError,
                },
              },
              meta: {
                mrIid: mr.iid,
                mrUrl: mr.webUrl,
              },
            };
          }

          const table: TableOutput = {
            headers: ["MR", "Bug", "CDP Comment", "MR URL"],
            rows: [[`!${mr.iid}`, ctx.bugId ?? "", commentStatus, mr.webUrl]],
          };

          const messageLines = [`Created MR !${mr.iid}: ${mr.title}`];
          if (commentOk) {
            messageLines.push(`Commented CDP bug ${ctx.bugId}`);
          } else if (ctx.commentError) {
            messageLines.push(
              `WARNING: CDP comment not created (${ctx.commentError})`,
            );
          } else {
            messageLines.push("WARNING: CDP comment not created");
          }

          return {
            success: true,
            data: table,
            message: messageLines.join("\n"),
            meta: {
              mrIid: mr.iid,
              mrUrl: mr.webUrl,
              bugId: ctx.bugId,
              commentCreated: commentOk,
            },
          };
        }),
      );

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
    help +=
      "Creates a GitLab MR and then posts a CDP bug comment (best-effort).\n\n";
    help += "Options (MR):\n";
    help +=
      "  --source <branch>       Source branch (default: infer from current git branch)\n";
    help += "  --target <branch>       Target branch (default: master)\n";
    help +=
      "  --title <title>         MR title (default: bug title or latest commit title)\n";
    help +=
      "  --description <text>    MR description template (default: built-in template; supports {{cdpLink}}/{{selfTestResults}}/{{utScreenshots}}/{{e2eScreenshots}}/{{solution}}/{{backendDependency}})\n";
    help += "  --labels <l1,l2>        Comma-separated labels\n";
    help += "  --assignee-id <id>      Assignee user ID\n";
    help += "  --reviewer-id <id>      Reviewer user ID\n";
    help += "  --reviewer-ids <ids>    Comma-separated reviewer user IDs\n";
    help +=
      "  --project <id|group/repo> Project ID (default: infer from git origin remote)\n";
    help +=
      "  --dry-run               Validate parameters without creating MR/comment\n\n";
    help += "Options (CDP Comment):\n";
    help +=
      "  --bug-id <id>           Bug label ID (optional if inferred from branch like abc-10476866)\n";
    help +=
      "  --comment <text>        Provide comment input (use a line with '---' to split reason/solution)\n";
    help += "  --comment-file <path>   Read comment input from a file\n";
    help += "  --reason <text>         Reason (required)\n";
    help += "  --solution <text>       Solution (required, also used for MR description '修改描述' field)\n";
    help +=
      "  --no-local-images       Do not upload ~/.mr-rocket/images/<bugId> files to CDP\n\n";
    help += "Example:\n";
    help +=
      '  mr-rocket mrx --source feature/bugfix --bug-id BUG-12345 --reason "root cause" --solution "fix applied"\n';
    return help;
  }

  private emitWarning(ctx: MrxChainContext, message: string): void {
    const formatted = warning(message);
    if (ctx.args.json) {
      process.stderr.write(formatted + "\n");
      return;
    }
    console.log(formatted);
  }

  private async inferGitBranch(): Promise<string> {
    const branch = await new Promise<string>((resolve, reject) => {
      execFile(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: process.cwd() },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `Unable to detect git branch (git not installed or not a git repo). ` +
                  `Run this command inside your repo root, or pass --source <branch>.\n` +
                  `Details: ${stderr || err.message}`,
              ),
            );
            return;
          }
          resolve(String(stdout ?? "").trim());
        },
      );
    });

    if (!branch || branch === "HEAD") {
      throw new ValidationError(
        "Cannot infer source branch (detached HEAD or empty branch). " +
          "Please run on a named branch or pass --source <branch>.",
      );
    }

    return branch;
  }

  private resolveProjectIdFromConfigOrRemote(
    config: AppConfig | undefined,
    gitProject: GitProjectRef,
  ): string {
    const repoNameLower = gitProject.repoName.toLowerCase();
    const fromConfig = config?.gitlab.projects?.find(
      (p) =>
        p.name.trim().toLowerCase() === repoNameLower && p.id.trim().length > 0,
    );

    return fromConfig?.id ?? gitProject.pathWithNamespace;
  }

  private async inferGitProjectOrThrow(
    expectedGitLabHost?: string,
  ): Promise<GitProjectRef> {
    let remote: string;
    try {
      remote = await this.inferGitOriginUrl();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new ValidationError(
        "Unable to infer GitLab project from current folder. " +
          "Make sure you're running inside the git repo and that 'origin' is configured, " +
          "or pass --project <id|group/repo>. " +
          `Details: ${error.message}`,
      );
    }

    const parsed = this.parseGitRemote(remote);

    if (expectedGitLabHost) {
      const expected = this.safeHostname(expectedGitLabHost);
      if (expected && expected.toLowerCase() !== parsed.host.toLowerCase()) {
        throw new ValidationError(
          `Git remote host (${parsed.host}) does not match configured gitlab.host (${expected}). ` +
            `Pass --project explicitly or update your config.`,
        );
      }
    }

    return parsed;
  }

  private async tryInferGitProject(
    expectedGitLabHost?: string,
  ): Promise<GitProjectRef | null> {
    try {
      return await this.inferGitProjectOrThrow(expectedGitLabHost);
    } catch {
      return null;
    }
  }

  private async inferGitOriginUrl(): Promise<string> {
    const tryExec = (args: string[]) =>
      new Promise<string>((resolve, reject) => {
        execFile("git", args, { cwd: process.cwd() }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(String(stderr || err.message)));
            return;
          }
          resolve(String(stdout ?? "").trim());
        });
      });

    try {
      const remote = await tryExec(["remote", "get-url", "origin"]);
      if (remote) return remote;
    } catch {
      // ignore
    }

    const remote = await tryExec(["config", "--get", "remote.origin.url"]);
    if (!remote) {
      throw new ValidationError(
        "Unable to infer GitLab project: git remote 'origin' is not configured. Provide --project.",
      );
    }
    return remote;
  }

  private parseGitRemote(remoteUrl: string): GitProjectRef {
    const raw = remoteUrl.trim();

    if (!raw) {
      throw new ValidationError(
        "Unable to infer GitLab project: empty git remote URL. Provide --project.",
      );
    }

    // https://host/group/repo(.git)
    // ssh://git@host/group/repo(.git)
    if (raw.includes("://")) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new ValidationError(
          `Unable to parse git remote URL: ${raw}. Provide --project.`,
        );
      }

      const host = url.hostname;
      const path = (url.pathname || "").replace(/^\/+/, "");
      const cleaned = path.replace(/\.git$/i, "");
      const repoName = cleaned.split("/").filter(Boolean).at(-1) ?? "";
      if (!host || !cleaned || !repoName) {
        throw new ValidationError(
          `Unable to infer GitLab project from remote URL: ${raw}. Provide --project.`,
        );
      }

      return { host, pathWithNamespace: cleaned, repoName };
    }

    // git@host:group/repo(.git)
    const scp = /^([^@]+)@([^:]+):(.+)$/.exec(raw);
    if (scp) {
      const host = scp[2] ?? "";
      const path = (scp[3] ?? "").replace(/^\/+/, "");
      const cleaned = path.replace(/\.git$/i, "");
      const repoName = cleaned.split("/").filter(Boolean).at(-1) ?? "";
      if (!host || !cleaned || !repoName) {
        throw new ValidationError(
          `Unable to infer GitLab project from remote URL: ${raw}. Provide --project.`,
        );
      }
      return { host, pathWithNamespace: cleaned, repoName };
    }

    throw new ValidationError(
      `Unsupported git remote format: ${raw}. Provide --project.`,
    );
  }

  private safeHostname(hostOrUrl: string): string | null {
    const trimmed = hostOrUrl.trim();
    if (!trimmed) return null;
    try {
      return new URL(trimmed).hostname;
    } catch {
      // If someone configures host without scheme, treat it as hostname.
      return trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || null;
    }
  }

  private async resolveCommentInput(args: ParsedArgs): Promise<CommentInput> {
    const reasonOpt = args.options.get("reason")?.trim();
    const solutionOpt = args.options.get("solution")?.trim();
    const commentText = args.options.get("comment");
    const commentFile = args.options.get("comment-file");

    let base: CommentInput = { reason: "", solution: "" };
    if (commentText) {
      base = this.parseCommentText(commentText);
    } else if (commentFile) {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(commentFile, "utf-8");
      base = this.parseCommentText(content);
    }

    const resolved: CommentInput = {
      reason: reasonOpt ?? base.reason,
      solution: solutionOpt ?? base.solution,
    };

    if (!resolved.solution) {
      throw new ValidationError(
        "CDP comment requires --solution. This value is also used for the MR description '修改描述' field.",
      );
    }

    if (!resolved.reason) {
      throw new ValidationError(
        "CDP comment requires --reason.",
      );
    }

    return resolved;
  }

  private parseCommentText(input: string): CommentInput {
    const raw = input.replace(/\r\n/g, "\n").trim();
    if (!raw) {
      return { reason: "", solution: "" };
    }

    const delimiterIndex = raw
      .split("\n")
      .findIndex((line) => line.trim() === "---");

    if (delimiterIndex >= 0) {
      const lines = raw.split("\n");
      const reason = lines.slice(0, delimiterIndex).join("\n").trim();
      const solution = lines
        .slice(delimiterIndex + 1)
        .join("\n")
        .trim();
      return { reason, solution };
    }

    const lines = raw.split("\n");
    const first = lines[0]?.trim() ?? "";
    const rest = lines.slice(1).join("\n").trim();
    return { reason: first, solution: rest };
  }

  private async resolveBugId(args: ParsedArgs): Promise<string> {
    const explicit = (
      args.options.get("bug-id") || args.options.get("bug")
    )?.trim();
    if (explicit) {
      return explicit;
    }

    try {
      const branch = await this.inferGitBranch();
      const match = /(?:^|.*)-(1\d{7})$/.exec(branch);
      const inferred = match?.[1]?.trim();
      if (inferred) {
        return inferred;
      }
    } catch {
      // ignore: fallback to explicit bug id
    }

    throw new ValidationError(
      "Bug ID is required. Provide via --bug-id or use a branch name containing something like abc-10476866.",
    );
  }

  private async resolveProjectId(ctx: MrxChainContext): Promise<string> {
    const explicitProject = ctx.args.options.get("project")?.trim();
    const defaultProject = ctx.config?.gitlab.defaultProjectId?.trim();

    const needsGitProject = !explicitProject && !defaultProject;
    const gitProject = needsGitProject
      ? await this.inferGitProjectOrThrow(ctx.config?.gitlab.host)
      : await this.tryInferGitProject(ctx.config?.gitlab.host);

    ctx.gitProject = gitProject ?? undefined;

    const resolvedProjectIdRaw =
      explicitProject ||
      defaultProject ||
      (gitProject
        ? this.resolveProjectIdFromConfigOrRemote(ctx.config, gitProject)
        : undefined);

    if (!resolvedProjectIdRaw) {
      throw new ValidationError(
        "Project ID required. Provide via --project <id|group/repo>, set gitlab.defaultProjectId in ~/.mr-rocket/config.json, " +
          "or run inside a git repo with an 'origin' remote pointing at your GitLab project.",
      );
    }

    const projectId = String(resolvedProjectIdRaw).trim();
    if (!projectId) {
      throw new ValidationError(
        "Project ID resolved to an empty value. Please pass --project <id|group/repo> or set gitlab.defaultProjectId.",
      );
    }

    return projectId;
  }

  private resolveProjectDefaults(
    ctx: MrxChainContext,
  ): GitLabProject | undefined {
    const projectId = ctx.projectId;
    if (!projectId) return undefined;

    return ctx.config?.gitlab.projects?.find((p) => {
      const idMatches = String(p.id) === String(projectId);
      const nameMatches =
        !!ctx.gitProject &&
        p.name.trim().toLowerCase() === ctx.gitProject.repoName.toLowerCase();
      return idMatches || nameMatches;
    });
  }

  private parseNumberOption(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private resolveReviewerIds(ctx: MrxChainContext): number[] | undefined {
    const reviewerIds = cliParser
      .extractArray(ctx.args.options, "reviewer-ids")
      .map((id) => this.parseNumberOption(id))
      .filter((id): id is number => typeof id === "number");
    return reviewerIds.length > 0 ? reviewerIds : undefined;
  }

  private resolveRawDescription(description: string | undefined): string {
    const trimmed = (description ?? "").trim();
    return trimmed.length > 0 ? (description ?? trimmed) : DESCRIPTION_TEMPLATE;
  }
}
