export interface AppConfig {
  version: string;
  gitlab: GitLabConfig;
  confluence: ConfluenceConfig;
  cdp?: CDPConfig;
  ui: UIConfig;
}

export interface GitLabProject {
  name: string;
  id: string;
  /**
   * Optional MR description template replacements.
   * These are inserted into the MR description template placeholders.
   */
  ut?: string;
  e2e?: string;
  assigneeId?: number;
  reviewerId?: number;
  reviewerIds?: Array<number>;
}

export interface GitLabConfig {
  host: string;
  token: string;
  defaultProjectId?: string;
  defaultBranch?: string;
  projects?: GitLabProject[];
  tls?: GitLabTLSConfig;
}

export interface GitLabTLSConfig {
  rejectUnauthorized?: boolean;
  caFile?: string;
}

export interface ConfluenceConfig {
  host: string;
  token: string;
  defaultSpaceKey?: string;
  tls?: ConfluenceTLSConfig;
}

export interface ConfluenceTLSConfig {
  rejectUnauthorized?: boolean;
  caFile?: string;
}

export interface CDPConfig {
  host: string;
  authFile?: string;
  tls?: CDPTLSConfig;
}

export interface CDPTLSConfig {
  rejectUnauthorized?: boolean;
  caFile?: string;
}

export interface UIConfig {
  refreshInterval: number;
  maxHistoryItems: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  version: "1.0.0",
  gitlab: {
    host: "https://gitlab.com",
    token: "YOUR_PERSONAL_ACCESS_TOKEN_HERE",
    defaultProjectId: "",
    defaultBranch: "main",
    projects: [],
    tls: {
      rejectUnauthorized: true,
      caFile: "",
    },
  },
  confluence: {
    host: "https://your-domain.atlassian.net/wiki",
    token: "YOUR_CONFLUENCE_PAT_HERE",
    defaultSpaceKey: "",
    tls: {
      rejectUnauthorized: true,
      caFile: "",
    },
  },
  cdp: {
    host: "https://your-cdp-domain.com",
    tls: {
      rejectUnauthorized: true,
      caFile: "",
    },
  },
  ui: {
    refreshInterval: 10000,
    maxHistoryItems: 1000,
  },
};
