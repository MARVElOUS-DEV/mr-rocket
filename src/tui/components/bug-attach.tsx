import type { TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState, useEffect } from "react";
import { saveClipboardImage } from "../../utils/clipboard-image.js";
import { getStore } from "../store.js";
import { showToast } from "./toast.js";
import { singleLineKeyBindings } from "../../utils/textarea-helper";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";

const IMAGES_DIR = join(homedir(), ".mr-rocket", "images");

type BugImages = { bugId: string; images: string[] };

export function BugAttach() {
  const store = getStore();
  const bugIdRef = useRef<TextareaRenderable>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [images, setImages] = useState<BugImages[]>([]);

  const loadImages = () => {
    if (!existsSync(IMAGES_DIR)) {
      setImages([]);
      return;
    }
    const bugs = readdirSync(IMAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d): BugImages => ({
        bugId: d.name,
        images: readdirSync(join(IMAGES_DIR, d.name)),
      }))
      .filter((b) => b.images.length > 0);
    setImages(bugs);
  };

  useEffect(() => {
    loadImages();
  }, []);

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

    const bugDir = join(IMAGES_DIR, bugId);
    if (!existsSync(bugDir)) {
      mkdirSync(bugDir, { recursive: true });
    }

    const existing = readdirSync(bugDir);
    const seq = String(existing.length + 1).padStart(3, "0");
    const destPath = join(bugDir, `${seq}.png`);
    copyFileSync(sourcePath, destPath);

    setMessage(`Saved: ${seq}.png`);
    showToast(`Image attached to ${bugId}`, "success");
    loadImages();
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (key.ctrl && key.name === "p") {
      void attachFromClipboard();
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Bug Image Attach</text>
      <text attributes={TextAttributes.DIM}>Ctrl+P paste from clipboard · Esc back</text>

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
          images.map((bug) => (
            <text key={bug.bugId} attributes={TextAttributes.DIM}>
              {bug.bugId}: {bug.images.join(", ")}
            </text>
          ))
        )}
      </box>
    </box>
  );
}
