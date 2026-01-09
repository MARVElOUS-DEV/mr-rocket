import { createReadStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../core/logger.js";
import type { GitLabTLSConfig } from "../models/config.js";
import type {
  CreateMRParams,
  MRFilter,
  CreateIssueParams,
  IssueFilter,
  MergeRequest,
  Issue,
  ProjectUpload,
} from "../models/gitlab.js";

let GitlabModule: typeof import("@gitbeaker/rest");

export class GitLabService {
  private api: any = null;

  constructor(
    private host: string,
    private token: string,
    private tls?: GitLabTLSConfig
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
      projectId: mr.projectId as number,
      title: String(mr.title),
      description: String(mr.description || ""),
      state: mr.state as MergeRequest["state"],
      createdAt: String(mr.createdAt),
      updatedAt: String(mr.updatedAt),
      sourceBranch: String(mr.sourceBranch),
      targetBranch: String(mr.targetBranch),
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
      webUrl: String(mr.webUrl),
      labels: (mr.labels as string[]) || [],
      mergeStatus: String(mr.mergeStatus || "cannot_be_merged"),
      hasConflicts: !!mr.hasConflicts,
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
            username: String((issue.assignee as Record<string, unknown>).username),
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

  async createMergeRequest(
    projectId: number | string,
    params: CreateMRParams
  ): Promise<MergeRequest> {
    const api = await this.ensureInitialized();
    logger.debug("Creating Merge Request", { projectId, params });
    try {
      const mr = await api.MergeRequests.create(projectId, {
        sourceBranch: params.sourceBranch,
        targetBranch: params.targetBranch,
        title: params.title,
        description: params.description,
        labels: params.labels,
        assigneeId: params.assigneeId,
      });

      logger.debug("Merge Request Created Successfully", { id: mr.id, iid: mr.iid });
      return this.mapMergeRequest(mr as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error("Failed to create merge request", err);
      throw new Error(`Failed to create merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getLatestCommitTitle(
    projectId: number | string,
    branch: string
  ): Promise<string> {
    const api = await this.ensureInitialized();
    logger.debug("Fetching latest commit title", { projectId, branch });
    try {
      const commits = await api.Commits.all(projectId, {
        refName: branch,
        perPage: 1,
        page: 1,
      });
      const commit = (commits as Array<Record<string, unknown>>)[0];
      if (!commit) {
        return "";
      }
      const title = typeof commit.title === "string" ? commit.title.trim() : "";
      if (title) {
        return title;
      }
      const message = typeof commit.message === "string" ? commit.message : "";
      return message.split("\n")[0]?.trim() || "";
    } catch (err) {
      logger.error("Failed to fetch latest commit title", err);
      throw new Error(
        `Failed to fetch latest commit title: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async uploadProjectFile(
    projectId: number | string,
    filePath: string
  ): Promise<ProjectUpload> {
    const api = await this.ensureInitialized();
    logger.debug("Uploading project file", { projectId, filePath });
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    try {
      const upload = await api.Projects.upload(projectId, createReadStream(filePath));
      return {
        url: String(upload.url),
        markdown: String(upload.markdown),
        alt: String(upload.alt || ""),
      };
    } catch (err) {
      logger.error("Failed to upload project file", err);
      throw new Error(
        `Failed to upload project file: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async listMergeRequests(
    projectId: number | string,
    filter: MRFilter = {}
  ): Promise<MergeRequest[]> {
    const api = await this.ensureInitialized();
    logger.debug("Listing Merge Requests", { projectId, filter });
    try {
      const mrs = await api.MergeRequests.all({
        projectId: String(projectId),
        state: filter.state,
        authorId: filter.authorId,
        assigneeId: filter.assigneeId ? parseInt(filter.assigneeId, 10) : undefined,
        labels: filter.labels?.join(","),
        search: filter.search,
        createdAfter: filter.createdAfter,
        createdBefore: filter.createdBefore,
      });

      logger.debug(`Found ${mrs.length} Merge Requests`);
      return (mrs as unknown as Array<Record<string, unknown>>).map((mr) => this.mapMergeRequest(mr));
    } catch (err) {
      logger.error("Failed to list merge requests", err);
      throw new Error(`Failed to list merge requests: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async approveMergeRequest(
    projectId: number | string,
    mrIid: number,
    message?: string
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
      throw new Error(`Failed to approve merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async mergeMergeRequest(
    projectId: number | string,
    mrIid: number,
    options?: { squash?: boolean; removeSourceBranch?: boolean }
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
      throw new Error(`Failed to merge merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async showMergeRequest(
    projectId: number | string,
    mrIid: number
  ): Promise<MergeRequest> {
    const api = await this.ensureInitialized();
    logger.debug("Showing Merge Request", { projectId, mrIid });
    try {
      const mr = await api.MergeRequests.show(projectId, mrIid);
      logger.debug("Merge Request Details Received");
      return this.mapMergeRequest(mr as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error("Failed to show merge request", err);
      throw new Error(`Failed to show merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createIssue(
    projectId: number | string,
    params: CreateIssueParams
  ): Promise<Issue> {
    const api = await this.ensureInitialized();
    logger.debug("Creating Issue", { projectId, params });
    try {
      const issue = await api.Issues.create(projectId, {
        title: params.title,
        description: params.description,
        labels: params.labels,
        assigneeId: params.assigneeId,
      });

      logger.debug("Issue Created Successfully", { id: issue.id, iid: issue.iid });
      return this.mapIssue(issue as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error("Failed to create issue", err);
      throw new Error(`Failed to create issue: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listIssues(
    projectId: number | string,
    filter: IssueFilter = {}
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
      return (issues as unknown as Array<Record<string, unknown>>).map((issue) => this.mapIssue(issue));
    } catch (err) {
      logger.error("Failed to list issues", err);
      throw new Error(`Failed to list issues: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
