import type { TextareaAction, TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { configManager } from "../../core/config-manager.js";
import { CDPService } from "../../services/cdp.service.js";
import {
  DESCRIPTION_TEMPLATE,
  prepareDescriptionWithUploads,
  prepareMrDescriptionFromTemplate,
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
  reviewerId?: number;
}

export function MRCreate() {
  const store = getStore();
  const gitlab = getGitLabService();
  const config = useMemo(() => configManager.getConfig(), []);

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
      reviewerId: p.reviewerId,
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

      const cdpBug = needsCdpBug
        ? await (async () => {
            const cdpService = new CDPService(config.cdp!);
            const { data } = await cdpService.getBug(bugId);
            return data.fieldMap;
          })()
        : undefined;

      let resolvedTitle = title;
      if (bugId && !title) {
        // Fetch bug title from CDP
        if (cdpBug) {
          resolvedTitle = `bug ${bugId}: ${cdpBug.title}`;
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
            cdpProductGroupId: cdpBug?.product_id,
            cdpItemId: cdpBug?.index_code,
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
        reviewerId: selectedProject?.reviewerId,
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
        Ctrl+S submit · Tab move · Esc back
      </text>

      {message ? (
        <text style={{ fg: status === "error" ? "red" : "green" }}>
          {message}
        </text>
      ) : null}

      <box flexDirection="column" gap={1}>
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
          <text attributes={TextAttributes.BOLD}>Target Branch (Optional)</text>
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
          <text attributes={TextAttributes.BOLD} style={{ fg: "red" }}>
            Bug ID (Required)
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

      {status === "submitting" ? (
        <text attributes={TextAttributes.DIM}>Creating merge request...</text>
      ) : null}
    </box>
  );
}
