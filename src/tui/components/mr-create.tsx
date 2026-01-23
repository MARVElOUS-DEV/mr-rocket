import type { TextareaAction, TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { configManager } from "../../core/config-manager.js";
import { CDPService, type BugMetadata } from "../../services/cdp.service.js";
import {
  buildCdpBugLink,
  DEFAULT_E2E_SCREENSHOTS,
  DEFAULT_UT_SCREENSHOTS,
  DESCRIPTION_TEMPLATE,
  prepareDescriptionWithUploads,
  prepareMrDescriptionFromTemplate,
  renderMrDescriptionTemplate,
} from "../../utils/description-images.js";
import { ValidationError, ValidationHelper } from "../../utils/validation.js";
import { getGitLabService } from "../client.js";
import { getStore } from "../store.js";
import { singleLineKeyBindings } from "../../utils/textarea-helper";

type SubmitState = "idle" | "submitting" | "success" | "error";

interface ProjectOption {
  name: string;
  description: string;
  value: string;
  utScreenshots?: string;
  e2eScreenshots?: string;
  assigneeId?: number;
  reviewerIds?: Array<number>;
}

type MrCreateFormSnapshot = {
  sourceBranch: string;
  targetBranch: string;
  bugId: string;
  title: string;
  labels: string;
  description: string;
};

const BUG_IMAGES_DIR = join(homedir(), ".mr-rocket", "images");

function isSupportedImage(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return (
    ext === ".png" ||
    ext === ".jpg" ||
    ext === ".jpeg" ||
    ext === ".gif" ||
    ext === ".webp"
  );
}

export function MRCreate() {
  const store = getStore();
  const gitlab = getGitLabService();
  const config = useMemo(() => configManager.getConfig(), []);
  const { width } = useTerminalDimensions();

  const sourceBranchRef = useRef<TextareaRenderable>(null);
  const targetBranchRef = useRef<TextareaRenderable>(null);
  const bugIdRef = useRef<TextareaRenderable>(null);
  const titleRef = useRef<TextareaRenderable>(null);
  const labelsRef = useRef<TextareaRenderable>(null);
  const descriptionRef = useRef<TextareaRenderable>(null);

  const projectOptions: ProjectOption[] = useMemo(() => {
    const projects = config.gitlab.projects || [];
    return projects.map((p) => ({
      name: p.name,
      description: `ID: ${p.id}`,
      value: p.id,
      utScreenshots: p.ut,
      e2eScreenshots: p.e2e,
      assigneeId: p.assigneeId,
      reviewerIds: p.reviewerIds,
    }));
  }, [config.gitlab.projects]);

  const defaultProjectIndex = useMemo(() => {
    const defaultId = config.gitlab.defaultProjectId || "";
    const idx = projectOptions.findIndex((p) => p.value === defaultId);
    return idx >= 0 ? idx : 0;
  }, [config.gitlab.defaultProjectId, projectOptions]);

  const [selectedProjectIndex, setSelectedProjectIndex] =
    useState(defaultProjectIndex);
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const [formSnapshot, setFormSnapshot] = useState<MrCreateFormSnapshot>({
    sourceBranch: "",
    targetBranch: "",
    bugId: "",
    title: "",
    labels: "",
    description: "",
  });

  const [cdpBug, setCdpBug] = useState<BugMetadata>();
  const [cdpBugError, setCdpBugError] = useState<string>();
  const [cdpBugLoading, setCdpBugLoading] = useState(false);

  const focusCount = 7;

  useEffect(() => {
    const target = descriptionRef.current as unknown as {
      plainText?: string;
      insertText?: (text: string) => void;
    };
    if (!target?.insertText) {
      return;
    }
    if (target.plainText?.trim()) {
      return;
    }
    target.insertText(DESCRIPTION_TEMPLATE);
  }, []);

  // Poll textarea values for live preview since OpenTUI textarea doesn't
  // expose onChange callbacks. Only updates state when values change.
  useEffect(() => {
    const id = setInterval(() => {
      const next: MrCreateFormSnapshot = {
        sourceBranch: sourceBranchRef.current?.plainText ?? "",
        targetBranch: targetBranchRef.current?.plainText ?? "",
        bugId: bugIdRef.current?.plainText ?? "",
        title: titleRef.current?.plainText ?? "",
        labels: labelsRef.current?.plainText ?? "",
        description: descriptionRef.current?.plainText ?? "",
      };

      setFormSnapshot((prev) =>
        prev.sourceBranch === next.sourceBranch &&
        prev.targetBranch === next.targetBranch &&
        prev.bugId === next.bugId &&
        prev.title === next.title &&
        prev.labels === next.labels &&
        prev.description === next.description
          ? prev
          : next,
      );
    }, 200);

    return () => clearInterval(id);
  }, []);

  const selectedProject = projectOptions[selectedProjectIndex];
  const resolvedProjectId =
    selectedProject?.value || config.gitlab.defaultProjectId || "";
  const previewBugId = formSnapshot.bugId.trim();
  const previewTitleInput = formSnapshot.title.trim();
  const previewDescription = formSnapshot.description;
  const previewHasTemplatePlaceholders =
    previewDescription.includes("{{cdpLink}}") ||
    previewDescription.includes("{{selfTestResults}}") ||
    previewDescription.includes("{{utScreenshots}}") ||
    previewDescription.includes("{{e2eScreenshots}}") ||
    previewDescription.trim().length === 0;

  const previewNeedsCdpBug =
    !!previewBugId &&
    !!config.cdp &&
    (previewDescription.includes("{{cdpLink}}") ||
      (!previewTitleInput && previewHasTemplatePlaceholders));

  useEffect(() => {
    let cancelled = false;

    if (!previewNeedsCdpBug || !config.cdp || !previewBugId) {
      setCdpBug(undefined);
      setCdpBugError(undefined);
      setCdpBugLoading(false);
      return;
    }

    setCdpBugLoading(true);
    setCdpBugError(undefined);

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const cdpService = new CDPService(config.cdp!);
          const { data } = await cdpService.getBug(previewBugId);
          if (!cancelled) {
            setCdpBug(data.fieldMap);
          }
        } catch (error) {
          if (!cancelled) {
            setCdpBug(undefined);
            setCdpBugError(
              error instanceof Error ? error.message : String(error),
            );
          }
        } finally {
          if (!cancelled) {
            setCdpBugLoading(false);
          }
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [config.cdp, previewBugId, previewNeedsCdpBug]);

  const previewBugImages = useMemo(() => {
    if (!previewBugId) {
      return [];
    }
    const dir = join(BUG_IMAGES_DIR, previewBugId);
    if (!existsSync(dir)) {
      return [];
    }
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }, [previewBugId]);

  const previewResolvedTitle = useMemo(() => {
    if (previewBugId && !previewTitleInput) {
      if (cdpBug?.title) {
        return `bug ${previewBugId}: ${cdpBug.title}`;
      }
      return `bug ${previewBugId}:`;
    }
    if (previewBugId && previewTitleInput) {
      return `bug ${previewBugId}: ${previewTitleInput}`;
    }
    if (!previewTitleInput) {
      return "Merge Request";
    }
    return previewTitleInput;
  }, [cdpBug?.title, previewBugId, previewTitleInput]);

  const previewTargetBranch =
    formSnapshot.targetBranch.trim() || config.gitlab.defaultBranch || "master";
  const previewSourceBranch = formSnapshot.sourceBranch.trim();
  const previewLabelsRaw = formSnapshot.labels.trim() || "bug";
  const previewLabelList = useMemo(
    () =>
      previewLabelsRaw
        .split(",")
        .map((label) => label.trim())
        .filter((label) => label.length > 0),
    [previewLabelsRaw],
  );

  const previewRenderedDescription = useMemo(() => {
    if (!previewHasTemplatePlaceholders) {
      return previewDescription.trim();
    }

    const template = previewDescription.trim()
      ? previewDescription
      : DESCRIPTION_TEMPLATE;

    const cdpLink =
      config.cdp?.host && cdpBug?.product_id && cdpBug?.index_code
        ? buildCdpBugLink(config.cdp.host, cdpBug.product_id, cdpBug.index_code)
        : "";

    const selfTestResults =
      previewBugId && previewBugImages.length > 0
        ? `(will upload ${previewBugImages.length} image(s): ${previewBugImages.join(", ")})`
        : "";

    const utScreenshots =
      selectedProject?.utScreenshots?.trim() || DEFAULT_UT_SCREENSHOTS;
    const e2eScreenshots =
      selectedProject?.e2eScreenshots?.trim() || DEFAULT_E2E_SCREENSHOTS;

    return renderMrDescriptionTemplate(template, {
      cdpLink,
      selfTestResults,
      utScreenshots,
      e2eScreenshots,
    });
  }, [
    cdpBug?.index_code,
    cdpBug?.product_id,
    config.cdp?.host,
    previewBugId,
    previewBugImages,
    previewDescription,
    previewHasTemplatePlaceholders,
    selectedProject?.e2eScreenshots,
    selectedProject?.utScreenshots,
  ]);

  const submit = async (): Promise<void> => {
    if (status === "submitting") {
      return;
    }

    setStatus("submitting");
    setMessage(null);

    try {
      const selectedProject = projectOptions[selectedProjectIndex];
      const resolvedProjectId =
        selectedProject?.value || config.gitlab.defaultProjectId;
      if (!resolvedProjectId) {
        throw new ValidationError(
          "Project ID required. Configure projects in config",
        );
      }

      const sourceBranch = sourceBranchRef.current?.plainText?.trim() || "";
      const targetBranch =
        targetBranchRef.current?.plainText?.trim() ||
        config.gitlab.defaultBranch ||
        "master";
      const bugId = bugIdRef.current?.plainText?.trim() || "";
      const title = titleRef.current?.plainText?.trim() || "";
      const labels = labelsRef.current?.plainText?.trim() || "bug";

      const rawDescription = descriptionRef.current?.plainText || "";
      const hasTemplatePlaceholders =
        rawDescription.includes("{{cdpLink}}") ||
        rawDescription.includes("{{selfTestResults}}") ||
        rawDescription.includes("{{utScreenshots}}") ||
        rawDescription.includes("{{e2eScreenshots}}") ||
        rawDescription.trim().length === 0;

      const needsCdpBug =
        !!bugId &&
        !!config.cdp &&
        (rawDescription.includes("{{cdpLink}}") ||
          (!title && hasTemplatePlaceholders));

      // Reuse the preview CDP bug data if it matches the current bugId,
      // otherwise fetch it fresh (handles race condition if user submits
      // before preview fetch completes)
      const resolvedCdpBug = needsCdpBug
        ? cdpBug && previewBugId === bugId
          ? cdpBug
          : await (async () => {
              const cdpService = new CDPService(config.cdp!);
              const { data } = await cdpService.getBug(bugId);
              return data.fieldMap;
            })()
        : undefined;

      let resolvedTitle = title;
      if (bugId && !title) {
        // Fetch bug title from CDP
        if (resolvedCdpBug) {
          resolvedTitle = `bug ${bugId}: ${resolvedCdpBug.title}`;
        } else if (!config.cdp) {
          resolvedTitle = `bug ${bugId}:`;
        } else {
          resolvedTitle = `bug ${bugId}:`;
        }
      } else if (bugId && title) {
        resolvedTitle = `bug ${bugId}: ${title}`;
      } else if (!title) {
        resolvedTitle = "Merge Request";
      }

      ValidationHelper.validateMRParams({
        sourceBranch,
        targetBranch,
        title: resolvedTitle,
      });

      const preparedDescription = hasTemplatePlaceholders
        ? await prepareMrDescriptionFromTemplate({
            gitlab,
            projectId: resolvedProjectId,
            template: rawDescription.trim() ? rawDescription : undefined,
            bugId: bugId || undefined,
            cdpHost: config.cdp?.host,
            cdpProductGroupId: resolvedCdpBug?.product_id,
            cdpItemId: resolvedCdpBug?.index_code,
            utScreenshots: selectedProject?.utScreenshots,
            e2eScreenshots: selectedProject?.e2eScreenshots,
          })
        : rawDescription.trim()
          ? await prepareDescriptionWithUploads(
              gitlab,
              resolvedProjectId,
              rawDescription.trim(),
            )
          : undefined;

      const labelList = labels
        .split(",")
        .map((label) => label.trim())
        .filter((label) => label.length > 0);

      const mr = await gitlab.createMergeRequest(resolvedProjectId, {
        sourceBranch,
        targetBranch,
        title: resolvedTitle,
        description: preparedDescription,
        labels: labelList.length > 0 ? labelList : undefined,
        assigneeId: selectedProject?.assigneeId,
        reviewerIds: selectedProject?.reviewerIds,
      });

      setStatus("success");
      setMessage(`Created MR !${mr.iid}: ${mr.title}`);
    } catch (error) {
      setStatus("error");
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Failed to create merge request");
      }
    }
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (key.ctrl && key.name === "s") {
      void submit();
    } else if (key.name === "tab") {
      const direction = key.shift ? -1 : 1;
      setFocusIndex(
        (current) => (current + direction + focusCount) % focusCount,
      );
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Create Merge Request</text>
      <text attributes={TextAttributes.DIM}>
        Ctrl+S submit · Tab move · Esc back · Split preview
      </text>

      {message ? (
        <text style={{ fg: status === "error" ? "red" : "green" }}>
          {message}
        </text>
      ) : null}

      <box flexDirection="row" flexGrow={1} gap={2}>
        <box flexDirection="column" gap={1} flexGrow={1}>
          <box flexDirection="column">
            <text attributes={TextAttributes.BOLD} style={{ fg: "red" }}>
              Project (Required, use ↑/↓ to select)
            </text>
            {projectOptions.length > 0 ? (
              <box style={{ border: true, height: 10 }}>
                <select
                  options={projectOptions}
                  style={{ height: 8, width: "100%" }}
                  selectedIndex={selectedProjectIndex}
                  onChange={(index) => setSelectedProjectIndex(index)}
                  focused={focusIndex === 0}
                />
              </box>
            ) : (
              <box style={{ border: true, height: 3 }}>
                <text attributes={TextAttributes.DIM} style={{ fg: "red" }}>
                  No projects configured
                </text>
              </box>
            )}
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.BOLD} style={{ fg: "red" }}>
              Source Branch (Required)
            </text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={sourceBranchRef}
                placeholder="feature/my-branch"
                focused={focusIndex === 1}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.BOLD}>
              Target Branch (Optional)
            </text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={targetBranchRef}
                placeholder="master"
                focused={focusIndex === 2}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.BOLD}>
              Bug ID (Optional)
            </text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={bugIdRef}
                placeholder="e.g. BUG-12345"
                focused={focusIndex === 3}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.BOLD}>Title (Optional)</text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={titleRef}
                placeholder="Defaults to bug title or commit title"
                focused={focusIndex === 4}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.BOLD}>Labels (Optional)</text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={labelsRef}
                placeholder="bug,ui,urgent"
                focused={focusIndex === 5}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column" flexGrow={1}>
            <text attributes={TextAttributes.BOLD} style={{ fg: "red" }}>
              Description (paste images here, modify template as needed)
            </text>
            <box style={{ border: true, flexGrow: 1, height: 8 }}>
              <textarea
                ref={descriptionRef}
                placeholder="Markdown supported"
                focused={focusIndex === 6}
                style={{ height: "100%", width: "100%" }}
              />
            </box>
          </box>
        </box>

        <box
          flexDirection="column"
          gap={1}
          width={Math.max(44, Math.floor(width * 0.45))}
        >
          <text attributes={TextAttributes.BOLD} style={{ fg: "cyan" }}>
            Preview (pre-upload)
          </text>

          <box style={{ border: true }} flexDirection="column" gap={0}>
            <text attributes={TextAttributes.DIM}>
              project: {selectedProject?.name || "<unconfigured>"} (
              {resolvedProjectId || "<missing>"})
            </text>
            <text attributes={TextAttributes.DIM}>
              sourceBranch: {previewSourceBranch || "<missing>"}
            </text>
            <text attributes={TextAttributes.DIM}>
              targetBranch: {previewTargetBranch}
            </text>
            <text attributes={TextAttributes.DIM}>
              bugId: {previewBugId || "<none>"}
            </text>
            <text attributes={TextAttributes.DIM}>
              title: {previewResolvedTitle}
            </text>
            <text attributes={TextAttributes.DIM}>
              labels:{" "}
              {previewLabelList.length > 0
                ? previewLabelList.join(", ")
                : "<none>"}
            </text>
            <text attributes={TextAttributes.DIM}>
              assigneeId: {selectedProject?.assigneeId ?? "<none>"}
            </text>
            <text attributes={TextAttributes.DIM}>
              reviewerIds:{" "}
              {selectedProject?.reviewerIds?.join(", ") ?? "<none>"}
            </text>
            {cdpBugLoading ? (
              <text attributes={TextAttributes.DIM} style={{ fg: "yellow" }}>
                fetching CDP bug…
              </text>
            ) : cdpBugError ? (
              <text attributes={TextAttributes.DIM} style={{ fg: "red" }}>
                CDP error: {cdpBugError}
              </text>
            ) : null}
          </box>

          <text attributes={TextAttributes.BOLD} style={{ fg: "cyan" }}>
            Rendered description
          </text>
          <box style={{ border: true, flexGrow: 1, height: 8 }}>
            <text>{previewRenderedDescription}</text>
          </box>
        </box>
      </box>

      {status === "submitting" ? (
        <text attributes={TextAttributes.DIM}>Creating merge request...</text>
      ) : null}
    </box>
  );
}
