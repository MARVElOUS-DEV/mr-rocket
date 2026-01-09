import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { configManager } from "../core/config-manager.js";
import { GitLabService } from "../services/gitlab.service.js";
import { TUIContext } from "./context.js";

let renderer: any = null;
let gitlabService: GitLabService | null = null;
let isInitialized = false;

export async function initializeTUI(): Promise<void> {
  if (isInitialized) {
    return;
  }

  await configManager.load();

  const config = configManager.getConfig();

  if (!config.gitlab.token || config.gitlab.token === "YOUR_PERSONAL_ACCESS_TOKEN_HERE") {
    throw new Error("GitLab token is not configured. Please edit ~/.mr-rocket/config.json");
  }

  if (!config.gitlab.host) {
    throw new Error("GitLab host is not configured. Please edit ~/.mr-rocket/config.json");
  }

  TUIContext.getInstance().setGitLabConfig(
    config.gitlab.host,
    config.gitlab.token,
    config.gitlab.defaultProjectId || ""
  );

  gitlabService = new GitLabService(config.gitlab.host, config.gitlab.token, config.gitlab.tls);
  await gitlabService.init();

  renderer = await createCliRenderer();
  isInitialized = true;
  await renderer.setupTerminal();
}

export function getRenderer(): any {
  if (!renderer) {
    throw new Error("TUI not initialized. Call initializeTUI first.");
  }
  return renderer;
}

export function getGitLabService(): GitLabService {
  if (!gitlabService) {
    throw new Error("TUI not initialized. Call initializeTUI first.");
  }
  return gitlabService;
}

export function createTUIRoot(): any {
  return createRoot(getRenderer());
}

export function cleanupTUI(): void {
  if (renderer) {
    renderer.destroy();
    renderer = null;
  }
  gitlabService = null;
  isInitialized = false;
}
