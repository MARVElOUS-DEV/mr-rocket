export interface MergeRequest {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description: string;
  state: "opened" | "closed" | "merged" | "locked";
  createdAt: string;
  updatedAt: string;
  sourceBranch: string;
  targetBranch: string;
  author: {
    id: number;
    username: string;
    name: string;
  };
  assignee?: {
    id: number;
    username: string;
    name: string;
  };
  webUrl: string;
  labels: string[];
  mergeStatus: string;
  hasConflicts: boolean;
}

export interface Issue {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description: string;
  state: "opened" | "closed";
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    username: string;
    name: string;
  };
  assignee?: {
    id: number;
    username: string;
    name: string;
  };
  webUrl: string;
  labels: string[];
}

export interface ProjectUpload {
  url: string;
  markdown: string;
  alt: string;
}

export interface CreateMRParams {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description?: string;
  labels?: string[];
  assigneeId?: number;
}

export interface MRFilter {
  state?: "opened" | "closed" | "merged";
  authorId?: number;
  assigneeId?: string;
  labels?: string[];
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface CreateIssueParams {
  title: string;
  description?: string;
  labels?: string[];
  assigneeId?: number;
}

export interface IssueFilter {
  state?: "opened" | "closed";
  authorId?: number;
  assigneeId?: number;
  labels?: string[];
  search?: string;
}
