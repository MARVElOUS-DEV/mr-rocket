import type { TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { CDPService } from "../../services/cdp.service.js";
import { configManager } from "../../core/config-manager.js";
import type { MergeRequest } from "../../models/gitlab.js";
import { getGitLabService } from "../client.js";
import { getStore } from "../store.js";
import { showToast } from "./toast.js";
import { singleLineKeyBindings } from "../../utils/textarea-helper";

type SubmitState = "idle" | "submitting" | "success" | "error";

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

function listLocalBugImagePaths(bugLabelId: string): string[] {
  const trimmed = bugLabelId.trim();
  if (!trimmed) {
    return [];
  }
  const dir = join(BUG_IMAGES_DIR, bugLabelId);
  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
      .map((entry) => join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

type GitLabClient = ReturnType<typeof getGitLabService>;

function pickBestMergeRequestForBug(
  candidates: MergeRequest[],
  bugLabelId: string,
): MergeRequest | undefined {
  const bugLower = bugLabelId.toLowerCase();
  const expectedPrefix = `bug ${bugLower}:`;

  const stateScore = (state: MergeRequest["state"]): number => {
    if (state === "opened") return 3;
    if (state === "merged") return 2;
    if (state === "closed") return 1;
    return 0;
  };

  const matchScore = (mr: MergeRequest): number => {
    const titleLower = mr.title.toLowerCase();
    const descLower = mr.description.toLowerCase();
    if (titleLower.startsWith(expectedPrefix)) return 3;
    if (titleLower.includes(bugLower)) return 2;
    if (descLower.includes(bugLower)) return 1;
    return 0;
  };

  const score = (mr: MergeRequest): number =>
    stateScore(mr.state) * 10 + matchScore(mr);

  const sorted = [...candidates].sort((a, b) => {
    const scoreDiff = score(b) - score(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const timeA = Date.parse(a.updatedAt) || 0;
    const timeB = Date.parse(b.updatedAt) || 0;
    return timeB - timeA;
  });

  return sorted.at(0);
}

async function findMergeRequestForBug(
  gitlab: GitLabClient,
  projectIds: string[],
  bugLabelId: string,
): Promise<MergeRequest | undefined> {
  const candidates: MergeRequest[] = [];

  const queryState = async (
    state: "opened" | "merged" | "closed",
  ): Promise<void> => {
    for (const projectId of projectIds) {
      try {
        const mrs = await gitlab.listMergeRequests(projectId, {
          state,
          search: bugLabelId,
        });
        candidates.push(...mrs);
      } catch {
        // Ignore per-project failures.
      }
    }
  };

  await queryState("opened");

  if (candidates.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  const unique: MergeRequest[] = [];
  for (const mr of candidates) {
    if (seen.has(mr.webUrl)) {
      continue;
    }
    seen.add(mr.webUrl);
    unique.push(mr);
  }

  return pickBestMergeRequestForBug(unique, bugLabelId);
}

type BugCommentFormSnapshot = {
  bugLabelId: string;
  reason: string;
  solution: string;
};

export function BugComment() {
  const store = getStore();
  const { width } = useTerminalDimensions();
  const config = useMemo(() => configManager.getConfig(), []);
  const gitlab = useMemo(() => getGitLabService(), []);

  const bugLabelIdRef = useRef<TextareaRenderable>(null);
  const reasonRef = useRef<TextareaRenderable>(null);
  const solutionRef = useRef<TextareaRenderable>(null);

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const [formSnapshot, setFormSnapshot] = useState<BugCommentFormSnapshot>({
    bugLabelId: "",
    reason: "",
    solution: "",
  });

  const [previewMr, setPreviewMr] = useState<MergeRequest>();
  const [previewMrLoading, setPreviewMrLoading] = useState(false);
  const [previewMrError, setPreviewMrError] = useState<string>();

  const focusCount = 3;

  useEffect(() => {
    const id = setInterval(() => {
      const next: BugCommentFormSnapshot = {
        bugLabelId: bugLabelIdRef.current?.plainText ?? "",
        reason: reasonRef.current?.plainText ?? "",
        solution: solutionRef.current?.plainText ?? "",
      };

      setFormSnapshot((prev) =>
        prev.bugLabelId === next.bugLabelId &&
        prev.reason === next.reason &&
        prev.solution === next.solution
          ? prev
          : next,
      );
    }, 200);

    return () => clearInterval(id);
  }, []);

  const projectIds = useMemo(
    () =>
      Array.from(
        new Set(
          [
            config.gitlab.defaultProjectId,
            ...(config.gitlab.projects || []).map((p) => p.id),
          ]
            .map((id) => id?.trim())
            .filter((id): id is string => !!id),
        ),
      ),
    [config.gitlab.defaultProjectId, config.gitlab.projects],
  );

  const previewBugLabelId = formSnapshot.bugLabelId.trim();
  const previewReason = formSnapshot.reason.trim();
  const previewSolution = formSnapshot.solution.trim();

  const previewLocalImagePaths = useMemo(
    () => listLocalBugImagePaths(previewBugLabelId),
    [previewBugLabelId],
  );

  const previewLocalImageNames = useMemo(
    () => previewLocalImagePaths.map((p) => basename(p)),
    [previewLocalImagePaths],
  );

  const previewNeedsMr = previewBugLabelId.length > 0 && projectIds.length > 0;

  useEffect(() => {
    let cancelled = false;

    if (!previewNeedsMr) {
      setPreviewMr(undefined);
      setPreviewMrError(undefined);
      setPreviewMrLoading(false);
      return;
    }

    setPreviewMrLoading(true);
    setPreviewMrError(undefined);

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const mr = await findMergeRequestForBug(
            gitlab,
            projectIds,
            previewBugLabelId,
          );
          if (!cancelled) {
            setPreviewMr(mr);
          }
        } catch (error) {
          if (!cancelled) {
            setPreviewMr(undefined);
            setPreviewMrError(
              error instanceof Error ? error.message : String(error),
            );
          }
        } finally {
          if (!cancelled) {
            setPreviewMrLoading(false);
          }
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [gitlab, previewBugLabelId, previewNeedsMr, projectIds]);

  const previewRenderedComment = useMemo(() => {
    const lines: string[] = [];
    lines.push(`○ 原因: ${previewReason || "<missing>"}`);
    lines.push(`○ 解决方案: ${previewSolution || "<missing>"}`);
    lines.push(`○ MR: ${previewMr?.webUrl || "<not found>"}`);
    lines.push("○ 自测结果:");

    if (previewLocalImageNames.length > 0) {
      lines.push(
        `- local (will upload ${previewLocalImageNames.length}): ${previewLocalImageNames.join(
          ", ",
        )}`,
      );
    }
    if (imageUrls.length > 0) {
      lines.push(`- clipboard (already uploaded ${imageUrls.length}):`);
      for (const [index, url] of imageUrls.entries()) {
        lines.push(`  ${index + 1}. ${url}`);
      }
    }
    if (previewLocalImageNames.length === 0 && imageUrls.length === 0) {
      lines.push("- <none>");
    }

    return lines.join("\n");
  }, [
    imageUrls,
    previewLocalImageNames,
    previewMr?.webUrl,
    previewReason,
    previewSolution,
  ]);

  const pasteImage = async () => {
    const bugLabelId = bugLabelIdRef.current?.plainText?.trim() || "";
    if (!bugLabelId) {
      setMessage("Enter Bug Label ID first");
      return;
    }
    setMessage("Uploading clipboard image...");
    try {
      if (!config.cdp) throw new Error("CDP not configured");
      const service = new CDPService(config.cdp);
      const url = await service.uploadClipboardImage();
      if (url) {
        setImageUrls((prev) => [...prev, url]);
        setMessage(`Image uploaded (${imageUrls.length + 1} total)`);
      } else {
        setMessage("No image in clipboard");
      }
    } catch (err: any) {
      setMessage(err.message);
    }
  };

  const submit = async () => {
    if (status === "submitting") return;
    const bugLabelId = bugLabelIdRef.current?.plainText?.trim() || "";
    const reason = reasonRef.current?.plainText?.trim() || "";
    const solution = solutionRef.current?.plainText?.trim() || "";

    if (!bugLabelId || !reason || !solution) {
      setMessage("All fields required");
      return;
    }

    setStatus("submitting");
    setMessage(null);

    try {
      if (!config.cdp) throw new Error("CDP not configured");
      const service = new CDPService(config.cdp);

      const mr =
        projectIds.length > 0
          ? await findMergeRequestForBug(gitlab, projectIds, bugLabelId)
          : undefined;

      const {
        data: { fieldMap: bug },
      } = await service.getBug(bugLabelId);

      const localImagePaths = listLocalBugImagePaths(bugLabelId);
      const uploadedLocalUrls: string[] = [];
      if (localImagePaths.length > 0) {
        setMessage(`Uploading ${localImagePaths.length} local image(s)...`);
        for (const filePath of localImagePaths) {
          const url = await service.uploadAttachment(filePath);
          if (url) {
            uploadedLocalUrls.push(url);
          }
        }
      }

      const mergedImageUrls = Array.from(
        new Set([...uploadedLocalUrls, ...imageUrls]),
      );

      await service.createComment(
        bug,
        reason,
        solution,
        mergedImageUrls,
        mr?.webUrl,
      );
      setStatus("success");
      setMessage(
        `Comment created for bug ${bugLabelId}${mr ? ` (MR: !${mr.iid})` : ""}`,
      );
      showToast(`Comment created for bug ${bugLabelId}`, "success");
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message);
    }
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (key.ctrl && key.name === "s") {
      void submit();
    } else if (key.ctrl && key.name === "p") {
      void pasteImage();
    } else if (key.name === "tab") {
      const direction = key.shift ? -1 : 1;
      setFocusIndex(
        (current) => (current + direction + focusCount) % focusCount,
      );
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Create Bug Comment</text>
      <text attributes={TextAttributes.DIM}>
        Ctrl+S submit · Ctrl+P paste image · Tab move · Esc back
      </text>

      {message && (
        <text
          style={{
            fg:
              status === "error"
                ? "red"
                : status === "success"
                  ? "green"
                  : "yellow",
          }}
        >
          {message}
        </text>
      )}

      <box flexDirection="row" flexGrow={1} gap={2}>
        <box flexDirection="column" gap={1} flexGrow={1}>
          <box flexDirection="column">
            <text attributes={TextAttributes.DIM}>Bug Label ID</text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={bugLabelIdRef}
                placeholder="e.g. BUG-12345"
                focused={focusIndex === 0}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.DIM}>原因 (Reason)</text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={reasonRef}
                placeholder="Bug cause"
                focused={focusIndex === 1}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.DIM}>解决方案 (Solution)</text>
            <box style={{ border: true, height: 3 }}>
              <textarea
                ref={solutionRef}
                placeholder="How it was fixed"
                focused={focusIndex === 2}
                keyBindings={singleLineKeyBindings}
              />
            </box>
          </box>

          <box flexDirection="column">
            <text attributes={TextAttributes.DIM}>
              Images ({imageUrls.length} uploaded) - Ctrl+P to paste from
              clipboard
            </text>
            {imageUrls.length > 0 && (
              <box flexDirection="column">
                {imageUrls.map((url, i) => (
                  <text key={i} attributes={TextAttributes.DIM}>
                    {" "}
                    {i + 1}. {url}
                  </text>
                ))}
              </box>
            )}
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
              bugLabelId: {previewBugLabelId || "<missing>"}
            </text>
            <text attributes={TextAttributes.DIM}>
              projectIds:{" "}
              {projectIds.length > 0 ? projectIds.join(", ") : "<none>"}
            </text>
            <text attributes={TextAttributes.DIM}>
              MR: {previewMr?.webUrl || "<not found>"}
            </text>
            <text attributes={TextAttributes.DIM}>
              localImages: {previewLocalImageNames.length}
            </text>
            <text attributes={TextAttributes.DIM}>
              clipboardImages: {imageUrls.length}
            </text>
            {previewMrLoading ? (
              <text attributes={TextAttributes.DIM} style={{ fg: "yellow" }}>
                searching MR…
              </text>
            ) : previewMrError ? (
              <text attributes={TextAttributes.DIM} style={{ fg: "red" }}>
                MR error: {previewMrError}
              </text>
            ) : null}
          </box>

          <text attributes={TextAttributes.BOLD} style={{ fg: "cyan" }}>
            Rendered comment
          </text>
          <box style={{ border: true, flexGrow: 1, height: 8 }}>
            <text>{previewRenderedComment}</text>
          </box>
        </box>
      </box>

      {status === "submitting" && (
        <text attributes={TextAttributes.DIM}>Creating comment...</text>
      )}
    </box>
  );
}
