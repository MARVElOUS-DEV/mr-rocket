import type { Gitlab } from "@gitbeaker/rest";
import type {
  CreateMRParams,
  MRFilter,
  CreateIssueParams,
  IssueFilter,
  MergeRequest,
  Issue,
} from "../models/gitlab.js";

let GitlabModule: typeof import("@gitbeaker/rest");

export class GitLabService {
  private api: Gitlab | null = null;

  constructor(private host: string, private token: string) {}

  async init(): Promise<void> {
    if (!GitlabModule) {
      GitlabModule = await import("@gitbeaker/rest");
    }

    this.api = new GitlabModule.Gitlab({
      host: this.host,
      token: this.token,
    });
  }

  private async ensureInitialized(): Promise<Gitlab> {
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

  async createMergeRequest(
    projectId: number | string,
    params: CreateMRParams
  ): Promise<MergeRequest> {
    const api = await this.ensureInitialized();
    try {
      const mr = await api.MergeRequests.create(projectId, {
        sourceBranch: params.sourceBranch,
        targetBranch: params.targetBranch,
        title: params.title,
        description: params.description,
        labels: params.labels,
        assigneeId: params.assigneeId,
      });

      return this.mapMergeRequest(mr as unknown as Record<string, unknown>);
    } catch (err) {
      throw new Error(`Failed to create merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listMergeRequests(
    projectId: number | string,
    filter: MRFilter = {}
  ): Promise<MergeRequest[]> {
    const api = await this.ensureInitialized();
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

      return (mrs as unknown as Array<Record<string, unknown>>).map((mr) => this.mapMergeRequest(mr));
    } catch (err) {
      throw new Error(`Failed to list merge requests: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async approveMergeRequest(
    projectId: number | string,
    mrIid: number,
    message?: string
  ): Promise<void> {
    const api = await this.ensureInitialized();
    try {
      await api.MergeRequests.approve(projectId, mrIid, {
        comment: message,
      });
    } catch (err) {
      throw new Error(`Failed to approve merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async mergeMergeRequest(
    projectId: number | string,
    mrIid: number,
    options?: { squash?: boolean; removeSourceBranch?: boolean }
  ): Promise<void> {
    const api = await this.ensureInitialized();
    try {
      await api.MergeRequests.merge(projectId, mrIid, {
        squash: options?.squash,
        shouldRemoveSourceBranch: options?.removeSourceBranch,
      });
    } catch (err) {
      throw new Error(`Failed to merge merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async showMergeRequest(
    projectId: number | string,
    mrIid: number
  ): Promise<MergeRequest> {
    const api = await this.ensureInitialized();
    try {
      const mr = await api.MergeRequests.show(projectId, mrIid);
      return this.mapMergeRequest(mr as unknown as Record<string, unknown>);
    } catch (err) {
      throw new Error(`Failed to show merge request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createIssue(
    projectId: number | string,
    params: CreateIssueParams
  ): Promise<Issue> {
    const api = await this.ensureInitialized();
    try {
      const issue = await api.Issues.create(projectId, {
        title: params.title,
        description: params.description,
        labels: params.labels,
        assigneeId: params.assigneeId,
      });

      return this.mapIssue(issue as unknown as Record<string, unknown>);
    } catch (err) {
      throw new Error(`Failed to create issue: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listIssues(
    projectId: number | string,
    filter: IssueFilter = {}
  ): Promise<Issue[]> {
    const api = await this.ensureInitialized();
    try {
      const issues = await api.Issues.all({
        projectId: String(projectId),
        state: filter.state,
        authorId: filter.authorId,
        assigneeId: filter.assigneeId,
        labels: filter.labels?.join(","),
        search: filter.search,
      });

      return (issues as unknown as Array<Record<string, unknown>>).map((issue) => this.mapIssue(issue));
    } catch (err) {
      throw new Error(`Failed to list issues: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
