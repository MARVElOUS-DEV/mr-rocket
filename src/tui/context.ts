import type { MergeRequest, Issue } from "../types/gitlab.js";

export class TUIContext {
  private static instance: TUIContext;
  private store: any;
  private gitLabProjectId: string;
  private gitlabHost: string;
  private gitlabToken: string;

  private constructor() {
    this.gitLabProjectId = "";
    this.gitlabHost = "";
    this.gitlabToken = "";
  }

  static getInstance(): TUIContext {
    if (!TUIContext.instance) {
      TUIContext.instance = new TUIContext();
    }
    return TUIContext.instance;
  }

  setStore(store: any): void {
    this.store = store;
  }

  getStore(): any {
    return this.store;
  }

  setGitLabConfig(host: string, token: string, projectId: string): void {
    this.gitlabHost = host;
    this.gitlabToken = token;
    this.gitLabProjectId = projectId;
  }

  getGitLabHost(): string {
    return this.gitlabHost;
  }

  getGitLabToken(): string {
    return this.gitlabToken;
  }

  getGitLabProjectId(): string {
    return this.gitLabProjectId;
  }

  isConfigured(): boolean {
    return !!this.gitlabToken && !!this.gitlabHost && !!this.gitLabProjectId;
  }
}

export interface TUIStore {
  state: {
    currentScreen: string;
    selectedMr?: MergeRequest;
    selectedMrIid?: number;
    selectedIssue?: Issue;
    selectedIssueIid?: number;
    error?: string;
    loadedM?: MergeRequest[];
    loadedI?: Issue[];
  };

  actions: {
    navigate(screen: string): void;
    selectMr(mr: MergeRequest, iid: number): void;
    selectIssue(issue: Issue, iid: number): void;
    setError(error: string): void;
    clearError(): void;
    setMergRequests(mrs: MergeRequest[]): void;
    setIssues(issues: Issue[]): void;
  };
}