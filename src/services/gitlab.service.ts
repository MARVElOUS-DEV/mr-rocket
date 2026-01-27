import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { logger } from "../core/logger.js";
import type { GitLabTLSConfig } from "../types/config.js";
import type {
  CreateMRParams,
  MRFilter,
  CreateIssueParams,
  IssueFilter,
  MergeRequest,
  Issue,
  ProjectUpload,
} from "../types/gitlab.js";

let GitlabModule: typeof import("@gitbeaker/rest");

export class GitLabService {
  private api: any = null;

  constructor(
    private host: string,
    private token: string,
    private tls?: GitLabTLSConfig,
  ) {}

  async init(): Promise<void> {
    if (!GitlabModule) {
      GitlabModule = await import("@gitbeaker/rest");
    }

    this.applyTlsConfig();
    logger.debug("Initializing GitLab API", { host: this.host });
    this.api = new GitlabModule.Gitlab({
      host: this.host,
      token: this.token,
    });
  }

  private async ensureInitialized(): Promise<any> {
    if (!this.api) {
      await this.init();
    }

    if (!this.api) {
      throw new Error("Failed to initialize GitLab API");
    }

    return this.api;
  }

  private mapMergeRequest(mr: Record<string, unknown>): MergeRequest {
    return {
      id: mr.id as number,
      iid: mr.iid as number,
      projectId: mr.project_id as number,
      title: String(mr.title),
      description: String(mr.description || ""),
      state: mr.state as MergeRequest["state"],
      createdAt: String(mr.created_at),
      updatedAt: String(mr.updated_at),
      sourceBranch: String(mr.source_branch),
      targetBranch: String(mr.target_branch),
      author: {
        id: (mr.author as Record<string, unknown>).id as number,
        username: String((mr.author as Record<string, unknown>).username),
        name: String((mr.author as Record<string, unknown>).name),
      },
      assignee: mr.assignee
        ? {
            id: (mr.assignee as Record<string, unknown>).id as number,
            username: String((mr.assignee as Record<string, unknown>).username),
            name: String((mr.assignee as Record<string, unknown>).name),
          }
        : undefined,
      webUrl: String(mr.web_url),
      labels: (mr.labels as string[]) || [],
      mergeStatus: String(mr.merge_status || "cannot_be_merged"),
      hasConflicts: !!mr.has_conflicts,
    };
  }

  private mapIssue(issue: Record<string, unknown>): Issue {
    return {
      id: issue.id as number,
      iid: issue.iid as number,
      projectId: issue.projectId as number,
      title: String(issue.title),
      description: String(issue.description || ""),
      state: issue.state as Issue["state"],
      createdAt: String(issue.createdAt),
      updatedAt: String(issue.updatedAt),
      author: {
        id: (issue.author as Record<string, unknown>).id as number,
        username: String((issue.author as Record<string, unknown>).username),
        name: String((issue.author as Record<string, unknown>).name),
      },
      assignee: issue.assignee
        ? {
            id: (issue.assignee as Record<string, unknown>).id as number,
            username: String(
              (issue.assignee as Record<string, unknown>).username,
            ),
            name: String((issue.assignee as Record<string, unknown>).name),
          }
        : undefined,
      webUrl: String(issue.webUrl),
      labels: (issue.labels as string[]) || [],
    };
  }

  private applyTlsConfig(): void {
    if (!this.tls) {
      return;
    }

    const caFile = this.tls.caFile?.trim();
    if (caFile) {
      const resolved = resolve(caFile);
      if (!existsSync(resolved)) {
        throw new Error(`GitLab TLS CA file not found: ${resolved}`);
      }
      process.env.NODE_EXTRA_CA_CERTS = resolved;
      process.env.BUN_TLS_CA_CERTS = resolved;
    }

    if (this.tls.rejectUnauthorized === false) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      process.env.BUN_TLS_REJECT_UNAUTHORIZED = "0";
    }
  }

  private async ensureMergeRequestReviewersAssigned(
    api: any,
    projectId: number | string,
    mrIid: number,
    desiredReviewerIds: number[],
  ): Promise<void> {
    if (desiredReviewerIds.length === 0) {
      return;
    }

    const uniqueDesired = Array.from(new Set(desiredReviewerIds));

    const buildGitLabErrorMeta = (err: unknown): Record<string, unknown> => {
      const anyErr = err as any;
      const cause = anyErr?.cause;
      return {
        message: anyErr?.message,
        description: cause?.description,
        responseBody: cause?.response?.body,
        responseText: cause?.response?.text,
        responseStatus: cause?.response?.status,
        stack: anyErr?.stack,
      };
    };

    try {
      const current = await api.MergeRequests.show(projectId, mrIid);
      const currentReviewerIds = Array.isArray(current?.reviewers)
        ? (current.reviewers as Array<Record<string, unknown>>)
            .map((r) => r.id)
            .filter((id): id is number => typeof id === "number")
        : [];

      const missing = uniqueDesired.filter(
        (id) => !currentReviewerIds.includes(id),
      );
      if (missing.length === 0) {
        return;
      }

      logger.warn(
        "Merge request reviewers not assigned on create; attempting to update",
        {
          projectId,
          mrIid,
          desiredReviewerIds: uniqueDesired,
          currentReviewerIds,
        },
      );

      await api.MergeRequests.edit(projectId, mrIid, {
        reviewerIds: uniqueDesired,
      });

      const updated = await api.MergeRequests.show(projectId, mrIid);
      const updatedReviewerIds = Array.isArray(updated?.reviewers)
        ? (updated.reviewers as Array<Record<string, unknown>>)
            .map((r) => r.id)
            .filter((id): id is number => typeof id === "number")
        : [];

      const stillMissing = uniqueDesired.filter(
        (id) => !updatedReviewerIds.includes(id),
      );
      if (stillMissing.length > 0) {
        logger.warn("Failed to assign all reviewers for merge request", {
          projectId,
          mrIid,
          desiredReviewerIds: uniqueDesired,
          updatedReviewerIds,
          stillMissing,
        });
      }
    } catch (error) {
      logger.warn("Failed to verify/update merge request reviewers", {
        projectId,
        mrIid,
        desiredReviewerIds: uniqueDesired,
        ...buildGitLabErrorMeta(error),
      });
    }
  }

  async createMergeRequest(
    projectId: number | string,
    params: CreateMRParams,
  ): Promise<MergeRequest> {
    const api = await this.ensureInitialized();

    const parseReviewerId = (value: unknown): number | undefined => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          return undefined;
        }
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : undefined;
      }
      return undefined;
    };

    const normalizedReviewerIds = Array.isArray(params.reviewerIds)
      ? params.reviewerIds
          .map((id) => parseReviewerId(id))
          .filter((id): id is number => typeof id === "number")
      : undefined;

    const reviewerId = parseReviewerId(params.reviewerId);

    const desiredReviewerIds =
      normalizedReviewerIds && normalizedReviewerIds.length > 0
        ? Array.from(new Set(normalizedReviewerIds))
        : reviewerId
          ? [reviewerId]
          : [];

    const requestParams = {
      sourceBranch: params.sourceBranch,
      targetBranch: params.targetBranch,
      title: params.title,
      description: params.description,
      labels: params.labels,
      assigneeId: params.assigneeId,
      reviewerIds:
        desiredReviewerIds.length > 0 ? desiredReviewerIds : undefined,
    };

    const options: Record<string, unknown> = {};
    if (params.description) {
      options.description = params.description;
    }
    if (params.labels && params.labels.length > 0) {
      options.labels = params.labels;
    }
    if (typeof params.assigneeId === "number") {
      options.assigneeId = params.assigneeId;
    }
    if (desiredReviewerIds.length > 0) {
      options.reviewerIds = desiredReviewerIds;
    }

    logger.debug("Creating Merge Request", { projectId, requestParams });
    try {
      const mr = await api.MergeRequests.create(
        projectId,
        params.sourceBranch,
        params.targetBranch,
        params.title,
        Object.keys(options).length > 0 ? options : undefined,
      );

      if (typeof mr?.iid === "number" && desiredReviewerIds.length > 0) {
        await this.ensureMergeRequestReviewersAssigned(
          api,
          projectId,
          mr.iid,
          desiredReviewerIds,
        );
      }

      logger.debug("Merge Request Created Successfully", {
        id: mr.id,
        iid: mr.iid,
      });
      return this.mapMergeRequest(mr as unknown as Record<string, unknown>);
    } catch (err: any) {
      const cause = err?.cause;
      // Try to extract error details from various possible locations
      const description = cause?.description;
      const responseBody = cause?.response?.body;
      const responseText = cause?.response?.text;
      const responseStatus = cause?.response?.status;
      const details =
        description || responseBody || err?.message || String(err);
      logger.error("Failed to create merge request", {
        message: err?.message,
        description,
        responseBody,
        responseText,
        responseStatus,
        stack: err?.stack,
      });
      throw new Error(
        `Failed to create merge request: ${typeof details === "object" ? JSON.stringify(details) : details}`,
      );
    }
  }

  async getLatestCommitTitle(
    projectId: number | string,
    branch: string,
  ): Promise<string> {
    const api = await this.ensureInitialized();
    logger.debug("Fetching latest commit title", { projectId, branch });
    try {
      const commits = await api.Commits.all(projectId, {
        refName: branch,
        perPage: 1,
        page: 1,
        maxPages: 1,
      });

      const first = (commits as unknown as Array<Record<string, unknown>>)[0];
      const title = first?.title ? String(first.title).trim() : "";
      return title || branch;
    } catch (err) {
      logger.warn("Failed to fetch latest commit title", {
        projectId,
        branch,
        message: err instanceof Error ? err.message : String(err),
      });
      return branch;
    }
  }

  async createIssue(
    projectId: number | string,
    params: CreateIssueParams,
  ): Promise<Issue> {
    const api = await this.ensureInitialized();

    const options: Record<string, unknown> = {};
    if (params.description) {
      options.description = params.description;
    }
    if (params.labels && params.labels.length > 0) {
      options.labels = params.labels.join(",");
    }
    if (typeof params.assigneeId === "number") {
      options.assigneeId = params.assigneeId;
    }

    logger.debug("Creating Issue", { projectId, title: params.title, options });
    try {
      const issue = await api.Issues.create(
        projectId,
        params.title,
        Object.keys(options).length > 0 ? options : undefined,
      );

      logger.debug("Issue Created Successfully", {
        id: issue.id,
        iid: issue.iid,
      });
      return this.mapIssue(issue as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error("Failed to create issue", err);
      throw new Error(
        `Failed to create issue: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listIssues(
    projectId: number | string,
    filter: IssueFilter = {},
  ): Promise<Issue[]> {
    const api = await this.ensureInitialized();
    logger.debug("Listing Issues", { projectId, filter });
    try {
      const issues = await api.Issues.all({
        projectId: String(projectId),
        state: filter.state,
        authorId: filter.authorId,
        assigneeId: filter.assigneeId,
        labels: filter.labels?.join(","),
        search: filter.search,
      });

      logger.debug(`Found ${issues.length} Issues`);
      return (issues as unknown as Array<Record<string, unknown>>).map(
        (issue) => this.mapIssue(issue),
      );
    } catch (err) {
      logger.error("Failed to list issues", err);
      throw new Error(
        `Failed to list issues: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async uploadProjectFile(
    projectId: number | string,
    filePath: string,
  ): Promise<ProjectUpload> {
    const api = await this.ensureInitialized();
    logger.debug("Uploading project file", { projectId, filePath });
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    try {
      const fileContent = await readFile(filePath);
      const upload = await api.Projects.uploadForReference(projectId, {
        content: new Blob([fileContent]),
        filename: basename(filePath),
      });
      return {
        url: String(upload.url),
        markdown: String(upload.markdown),
        alt: String(upload.alt || ""),
      };
    } catch (err) {
      logger.error("Failed to upload project file", err);
      throw new Error(
        `Failed to upload project file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listMergeRequests(
    projectId: number | string | undefined,
    filter: MRFilter = {},
  ): Promise<MergeRequest[]> {
    const api = await this.ensureInitialized();

    const state = filter.state ?? "opened";
    const scope =
      filter.scope ??
      (typeof filter.authorId === "number" ? "all" : "created_by_me");

    logger.debug("Listing Merge Requests", { projectId, filter, state, scope });
    try {
      const options: Record<string, unknown> = {
        state,
        scope,
        authorId: filter.authorId,
        assigneeId: filter.assigneeId
          ? parseInt(filter.assigneeId, 10)
          : undefined,
        labels: filter.labels?.join(","),
        search: filter.search,
        createdAfter: filter.createdAfter,
        createdBefore: filter.createdBefore,
      };

      if (projectId !== undefined && String(projectId).trim()) {
        options.projectId = String(projectId);
      }

      const mrs = await api.MergeRequests.all(options);

      logger.debug(`Found ${mrs.length} Merge Requests`);
      return (mrs as unknown as Array<Record<string, unknown>>).map((mr) =>
        this.mapMergeRequest(mr),
      );
    } catch (err) {
      logger.error("Failed to list merge requests", err);
      throw new Error(
        `Failed to list merge requests: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async approveMergeRequest(
    projectId: number | string,
    mrIid: number,
    message?: string,
  ): Promise<void> {
    const api = await this.ensureInitialized();
    logger.debug("Approving Merge Request", { projectId, mrIid, message });
    try {
      await api.MergeRequests.approve(projectId, mrIid, {
        comment: message,
      });
      logger.debug("Merge Request Approved Successfully");
    } catch (err) {
      logger.error("Failed to approve merge request", err);
      throw new Error(
        `Failed to approve merge request: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async mergeMergeRequest(
    projectId: number | string,
    mrIid: number,
    options?: { squash?: boolean; removeSourceBranch?: boolean },
  ): Promise<void> {
    const api = await this.ensureInitialized();
    logger.debug("Merging Merge Request", { projectId, mrIid, options });
    try {
      await api.MergeRequests.merge(projectId, mrIid, {
        squash: options?.squash,
        shouldRemoveSourceBranch: options?.removeSourceBranch,
      });
      logger.debug("Merge Request Merged Successfully");
    } catch (err) {
      logger.error("Failed to merge merge request", err);
      throw new Error(
        `Failed to merge merge request: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async showMergeRequest(
    projectId: number | string,
    mrIid: number,
  ): Promise<MergeRequest> {
    const api = await this.ensureInitialized();
    logger.debug("Showing Merge Request", { projectId, mrIid });
    try {
      const mr = await api.MergeRequests.show(projectId, mrIid);
      logger.debug("Merge Request Details Received");
      return this.mapMergeRequest(mr as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error("Failed to show merge request", err);
      throw new Error(
        `Failed to show merge request: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
