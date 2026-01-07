export interface AppConfig {
  version: string;
  gitlab: GitLabConfig;
  ui: UIConfig;
}

export interface GitLabConfig {
  host: string;
  token: string;
  defaultProjectId?: string;
  defaultBranch?: string;
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
  },
  ui: {
    refreshInterval: 10000,
    maxHistoryItems: 1000,
  },
};
