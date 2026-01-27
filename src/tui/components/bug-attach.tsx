import type { TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState, useEffect } from "react";
import { saveClipboardImage } from "../../utils/clipboard-image.js";
import { getStore } from "../store.js";
import { showToast } from "./toast.js";
import { singleLineKeyBindings } from "../../utils/textarea-helper";
import { extname, join } from "node:path";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import {
  cleanupOutdatedBugImages,
  deleteBugImage,
  ensureBugDir,
  getNextSequence,
  listStoredBugImages,
  type StoredBugImages,
} from "../../utils/bug-image-store.js";

const IMAGE_RETENTION_DAYS = 30;

export function BugAttach() {
  const store = getStore();
  const bugIdRef = useRef<TextareaRenderable>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [images, setImages] = useState<StoredBugImages[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<{ bugId: string; fileName: string } | null>(
    null,
  );

  const loadImages = () => {
    const bugs = listStoredBugImages();
    setImages(bugs);
    setSelectedIndex((current) => {
      const total = bugs.reduce((sum, b) => sum + b.images.length, 0);
      if (total === 0) return 0;
      return Math.max(0, Math.min(current, total - 1));
    });
  };

  useEffect(() => {
    const { deletedFiles } = cleanupOutdatedBugImages(IMAGE_RETENTION_DAYS);
    if (deletedFiles > 0) {
      showToast(`Auto-removed ${deletedFiles} outdated image(s) (>${IMAGE_RETENTION_DAYS}d)`, "info");
    }
    loadImages();
  }, []);

  const getSelectedItem = (): { bugId: string; fileName: string } | null => {
    let cursor = 0;
    for (const bug of images) {
      for (const img of bug.images) {
        if (cursor === selectedIndex) {
          return { bugId: bug.bugId, fileName: img.fileName };
        }
        cursor += 1;
      }
    }
    return null;
  };

  const requestDeleteSelected = () => {
    const item = getSelectedItem();
    if (!item) return;
    setPendingDelete(item);
    setMessage(`Delete ${item.bugId}/${item.fileName}? (y/n)`);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    try {
      const ok = deleteBugImage(pendingDelete.bugId, pendingDelete.fileName);
      if (ok) {
        showToast(`Deleted ${pendingDelete.bugId}/${pendingDelete.fileName}`, "success");
      } else {
        showToast(`Not found: ${pendingDelete.bugId}/${pendingDelete.fileName}`, "error");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPendingDelete(null);
      setMessage(null);
      loadImages();
    }
  };

  const attachFromClipboard = async () => {
    const bugId = bugIdRef.current?.plainText?.trim() || "";
    if (!bugId) {
      setMessage("Enter Bug ID first");
      return;
    }

    setMessage("Reading clipboard...");
    const sourcePath = await saveClipboardImage();
    if (!sourcePath) {
      setMessage("No image in clipboard");
      return;
    }

    let bugDir: string;
    try {
      bugDir = ensureBugDir(bugId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }

    const existing = existsSync(bugDir) ? readdirSync(bugDir) : [];
    const seq = getNextSequence(existing);
    const ext = extname(sourcePath) || ".png";
    const destPath = join(bugDir, `${seq}${ext}`);
    copyFileSync(sourcePath, destPath);

    setMessage(`Saved: ${seq}${ext}`);
    showToast(`Image attached to ${bugId}`, "success");
    loadImages();
  };

  useKeyboard((key) => {
    if (pendingDelete) {
      if (key.name === "y") {
        confirmDelete();
      } else if (key.name === "n" || key.name === "escape") {
        setPendingDelete(null);
        setMessage(null);
      }
      return;
    }

    if (key.name === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (key.ctrl && key.name === "p") {
      void attachFromClipboard();
    } else if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down" || key.name === "j") {
      const total = images.reduce((sum, b) => sum + b.images.length, 0);
      setSelectedIndex((i) => Math.min(Math.max(0, total - 1), i + 1));
    } else if (key.name === "d") {
      requestDeleteSelected();
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Bug Image Attach</text>
      <text attributes={TextAttributes.DIM}>
        Ctrl+P paste from clipboard · ↑/↓ select · d delete · Esc back
      </text>

      {message && <text style={{ fg: "yellow" }}>{message}</text>}

      <box flexDirection="column">
        <text attributes={TextAttributes.DIM}>Bug ID</text>
        <box style={{ border: true, height: 3 }}>
          <textarea
            ref={bugIdRef}
            placeholder="e.g. BUG-12345"
            focused={true}
            keyBindings={singleLineKeyBindings}
          />
        </box>
      </box>

      <box flexDirection="column">
        <text attributes={TextAttributes.BOLD}>Stored Images:</text>
        {images.length === 0 ? (
          <text attributes={TextAttributes.DIM}>No images stored yet</text>
        ) : (
          (() => {
            let cursor = 0;
            return images.map((bug) => (
              <box key={bug.bugId} flexDirection="column" paddingTop={1}>
                <text attributes={TextAttributes.BOLD}>{bug.bugId}</text>
                {bug.images.map((img) => {
                  const rowIndex = cursor;
                  cursor += 1;
                  const selected = rowIndex === selectedIndex;
                  return (
                    <box key={`${bug.bugId}/${img.fileName}`} flexDirection="row" gap={1}>
                      <text
                        flexGrow={1}
                        attributes={selected ? TextAttributes.BOLD : TextAttributes.DIM}
                        style={selected ? { bg: "cyan", fg: "black" } : undefined}
                      >
                        {img.fileName}
                      </text>
                      <text attributes={TextAttributes.DIM}>[d] delete</text>
                    </box>
                  );
                })}
              </box>
            ));
          })()
        )}
      </box>
    </box>
  );
}
