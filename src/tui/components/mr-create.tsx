import type { TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import { configManager } from "../../core/config-manager.js";
import { prepareDescriptionWithUploads } from "../../utils/description-images.js";
import { ValidationError, ValidationHelper } from "../../utils/validation.js";
import { getGitLabService } from "../client.js";
import { getStore } from "../store.js";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function MRCreate() {
  const store = getStore();
  const gitlab = getGitLabService();
  const config = useMemo(() => configManager.getConfig(), []);
  const textareaRef = useRef<TextareaRenderable>(null);

  const [projectId, setProjectId] = useState(config.gitlab.defaultProjectId || "");
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState(config.gitlab.defaultBranch || "master");
  const [title, setTitle] = useState("");
  const [labels, setLabels] = useState("");
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const focusCount = 6;

  const submit = async (): Promise<void> => {
    if (status === "submitting") {
      return;
    }

    setStatus("submitting");
    setMessage(null);

    try {
      const resolvedProjectId = projectId || config.gitlab.defaultProjectId;
      if (!resolvedProjectId) {
        throw new ValidationError("Project ID required. Provide via input or config");
      }

      const resolvedTitle =
        title || (await gitlab.getLatestCommitTitle(resolvedProjectId, sourceBranch));

      ValidationHelper.validateMRParams({
        sourceBranch,
        targetBranch,
        title: resolvedTitle,
      });

      const description = textareaRef.current?.plainText?.trim() || "";
      const preparedDescription = description
        ? await prepareDescriptionWithUploads(gitlab, resolvedProjectId, description)
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
      setFocusIndex((current) => (current + direction + focusCount) % focusCount);
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Create Merge Request</text>
      <text attributes={TextAttributes.DIM}>Ctrl+S submit · Tab move · Esc back</text>

      {message ? (
        <text style={{ fg: status === "error" ? "red" : "green" }}>{message}</text>
      ) : null}

      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Project ID</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={projectId}
              onInput={setProjectId}
              placeholder="Uses default from config"
              focused={focusIndex === 0}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Source Branch</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={sourceBranch}
              onInput={setSourceBranch}
              placeholder="feature/my-branch"
              focused={focusIndex === 1}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Target Branch</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={targetBranch}
              onInput={setTargetBranch}
              placeholder="main"
              focused={focusIndex === 2}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Title</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={title}
              onInput={setTitle}
              placeholder="Defaults to latest commit title"
              focused={focusIndex === 3}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Labels</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={labels}
              onInput={setLabels}
              placeholder="bug,ui,urgent"
              focused={focusIndex === 4}
            />
          </box>
        </box>

        <box flexDirection="column" flexGrow={1}>
          <text attributes={TextAttributes.DIM}>Description (paste images here)</text>
          <box style={{ border: true, flexGrow: 1, height: 8 }}>
            <textarea ref={textareaRef} placeholder="Markdown supported" focused={focusIndex === 5} />
          </box>
        </box>
      </box>

      {status === "submitting" ? (
        <text attributes={TextAttributes.DIM}>Creating merge request...</text>
      ) : null}
    </box>
  );
}
