export interface AppConfig {
  version: string;
  gitlab: GitLabConfig;
  confluence: ConfluenceConfig;
  ui: UIConfig;
}

export interface GitLabConfig {
  host: string;
  token: string;
  defaultProjectId?: string;
  defaultBranch?: string;
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
    tls: {
      rejectUnauthorized: true,
      caFile: "",
    },
  },
  confluence: {
    host: "https://your-domain.atlassian.net/wiki",
    token: "YOUR_CONFLUENCE_PAT_HERE",
    defaultSpaceKey: "",
  },
  ui: {
    refreshInterval: 10000,
    maxHistoryItems: 1000,
  },
};
