import { createCliRenderer } from "@opentui/core";
import type { CliRenderer, PasteEvent } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { configManager } from "../core/config-manager.js";
import { GitLabService } from "../services/gitlab.service.js";
import { ConfluenceService } from "../services/confluence.service.js";
import { TUIContext } from "./context.js";

let renderer: CliRenderer| null = null;
let gitlabService: GitLabService | null = null;
let confluenceService: ConfluenceService | null = null;
let isInitialized = false;

type PasteInsertTarget = {
  insertText?: (text: string) => void;
  handlePaste?: (event: PasteEvent) => void;
};

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

  renderer = await createCliRenderer({ useMouse: false });
  isInitialized = true;

  renderer.keyInput.on("paste", (event: PasteEvent) => {
    const target = getRenderer().currentFocusedRenderable as PasteInsertTarget | null;
    if (!target) {
      return;
    }
    if (typeof target.handlePaste === "function") {
      return;
    }
    if (typeof target.insertText === "function") {
      target.insertText(event.text);
      event.preventDefault();
    }
  });
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

export function getConfluenceService(): ConfluenceService {
  if (confluenceService) {
    return confluenceService;
  }

  const config = configManager.getConfig();
  if (!config.confluence?.host) {
    throw new Error("Confluence host is not configured. Please edit ~/.mr-rocket/config.json");
  }
  if (
    !config.confluence.token ||
    config.confluence.token === "YOUR_CONFLUENCE_PAT_HERE"
  ) {
    throw new Error("Confluence token is not configured. Please edit ~/.mr-rocket/config.json");
  }

  confluenceService = new ConfluenceService(
    config.confluence.host,
    config.confluence.token,
    config.confluence.tls,
    config.confluence.apiPrefix,
    config.cdp,
  );
  return confluenceService;
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
  confluenceService = null;
  isInitialized = false;
}
