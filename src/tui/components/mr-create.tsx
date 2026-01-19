import type { TextareaAction, TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import { configManager } from "../../core/config-manager.js";
import { prepareDescriptionWithUploads } from "../../utils/description-images.js";
import { ValidationError, ValidationHelper } from "../../utils/validation.js";
import { getGitLabService } from "../client.js";
import { getStore } from "../store.js";
import { singleLineKeyBindings } from "../../utils/textarea-helper";

type SubmitState = "idle" | "submitting" | "success" | "error";

interface ProjectOption {
  name: string;
  description: string;
  value: string;
}

export function MRCreate() {
  const store = getStore();
  const gitlab = getGitLabService();
  const config = useMemo(() => configManager.getConfig(), []);

  const sourceBranchRef = useRef<TextareaRenderable>(null);
  const targetBranchRef = useRef<TextareaRenderable>(null);
  const titleRef = useRef<TextareaRenderable>(null);
  const labelsRef = useRef<TextareaRenderable>(null);
  const descriptionRef = useRef<TextareaRenderable>(null);

  const projectOptions: ProjectOption[] = useMemo(() => {
    const projects = config.gitlab.projects || [];
    return projects.map((p) => ({
      name: p.name,
      description: `ID: ${p.id}`,
      value: p.id,
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

  const focusCount = 6;

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
      const title = titleRef.current?.plainText?.trim() || "";
      const labels = labelsRef.current?.plainText?.trim() || "";

      const resolvedTitle =
        title ||
        (await gitlab.getLatestCommitTitle(resolvedProjectId, sourceBranch));

      ValidationHelper.validateMRParams({
        sourceBranch,
        targetBranch,
        title: resolvedTitle,
      });

      const description = descriptionRef.current?.plainText?.trim() || "";
      const preparedDescription = description
        ? await prepareDescriptionWithUploads(
            gitlab,
            resolvedProjectId,
            description,
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
          <text attributes={TextAttributes.BOLD}>Project (↑/↓ to select)</text>
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
              <text attributes={TextAttributes.DIM}>
                No projects configured
              </text>
            </box>
          )}
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Source Branch</text>
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
          <text attributes={TextAttributes.BOLD}>Target Branch</text>
          <box style={{ border: true, height: 3 }}>
            <textarea
              ref={targetBranchRef}
              placeholder="main"
              focused={focusIndex === 2}
              keyBindings={singleLineKeyBindings}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Title</text>
          <box style={{ border: true, height: 3 }}>
            <textarea
              ref={titleRef}
              placeholder="Defaults to latest commit title"
              focused={focusIndex === 3}
              keyBindings={singleLineKeyBindings}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Labels</text>
          <box style={{ border: true, height: 3 }}>
            <textarea
              ref={labelsRef}
              placeholder="bug,ui,urgent"
              focused={focusIndex === 4}
              keyBindings={singleLineKeyBindings}
            />
          </box>
        </box>

        <box flexDirection="column" flexGrow={1}>
          <text attributes={TextAttributes.BOLD}>
            Description (paste images here)
          </text>
          <box style={{ border: true, flexGrow: 1, height: 8 }}>
            <textarea
              ref={descriptionRef}
              placeholder="Markdown supported"
              focused={focusIndex === 5}
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
