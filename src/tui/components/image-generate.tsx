import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { stripVTControlCharacters } from "node:util";
import { useEffect, useRef, useState } from "react";
import { configManager } from "../../core/config-manager.js";
import type {
  ImageWorkflowEvent,
  ImageWorkflowLog,
} from "../../types/image-workflow.js";
import { saveClipboardImage } from "../../utils/clipboard-image.js";
import { singleLineKeyBindings } from "../../utils/textarea-helper.js";
import { imageGenerationWorkflow } from "../../workflows/image-generation.js";
import { getStore } from "../store.js";

type RunState = "idle" | "running" | "completed" | "cancelled" | "failed";
const LOG_SCROLL_KEYS = new Set([
  "up",
  "down",
  "k",
  "j",
  "pageup",
  "pagedown",
  "home",
  "end",
]);

export function ImageGenerate() {
  const store = getStore();
  const promptRef = useRef<TextareaRenderable>(null);
  const referencesRef = useRef<TextareaRenderable>(null);
  const logsRef = useRef<ScrollBoxRenderable>(null);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const config = configManager.getConfig().imageGeneration;
  const [focus, setFocus] = useState(0);
  const [state, setState] = useState<RunState>("idle");
  const [events, setEvents] = useState<ImageWorkflowEvent[]>([]);
  const [logs, setLogs] = useState<ImageWorkflowLog[]>([]);
  const [followLogs, setFollowLogs] = useState(true);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [logPath, setLogPath] = useState("");
  const [currentLogPath, setCurrentLogPath] = useState("");

  const activity = [
    ...events.map((event) => ({
      timestamp: event.timestamp,
      color: "white",
      text: `${event.iteration ? `${event.iteration}. ` : ""}[${event.phase}] ${event.message}`,
    })),
    ...logs.map((log) => ({
      timestamp: log.timestamp,
      color: log.stream === "stderr" ? "yellow" : "gray",
      text: `[${log.agent}:${log.stream}] ${log.text}`,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const start = async () => {
    if (state === "running") return;
    const prompt = promptRef.current?.plainText?.trim() || "";
    if (!prompt) {
      setError("Describe the image first");
      return;
    }
    const references = (referencesRef.current?.plainText || "")
      .split(/[\n,]/)
      .map((path) => path.trim())
      .filter(Boolean);

    const controller = new AbortController();
    controllerRef.current = controller;
    setState("running");
    setEvents([]);
    setLogs([]);
    setFollowLogs(true);
    setImages([]);
    setError("");
    setLogPath("");
    setCurrentLogPath("");
    try {
      const result = await imageGenerationWorkflow.run(
        {
          prompt,
          referenceImages: references,
        },
        {
          signal: controller.signal,
          onEvent: (event) =>
            setEvents((current) => [...current, event]),
          onAgentOutput: (log) => {
            const text = stripVTControlCharacters(log.text).replaceAll(
              "\r",
              "",
            );
            const lines = text
              .split("\n")
              .filter(Boolean)
              .map((text) => ({ ...log, text: text.slice(0, 4000) }));
            // ponytail: UI stays bounded; the workflow live file retains the full transcript.
            setLogs((current) => [...current, ...lines].slice(-2000));
          },
          onLogReady: (path, currentPath) => {
            setLogPath(path);
            setCurrentLogPath(currentPath);
          },
          onLogError: (cause) =>
            setError(`Live log unavailable: ${cause.message}`),
        },
      );
      setImages(result.images);
      setState("completed");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        setState("cancelled");
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
        setState("failed");
      }
    } finally {
      controllerRef.current = undefined;
    }
  };

  const pasteReference = async () => {
    const path = await saveClipboardImage();
    if (!path) {
      setError("Clipboard does not contain an image");
      return;
    }
    const input = referencesRef.current;
    if (input?.plainText?.trim()) input.insertText(", ");
    input?.insertText(path);
    setError("");
  };

  useKeyboard((key) => {
    const logsFocused = state === "running" || focus === 2;
    if (logsFocused && LOG_SCROLL_KEYS.has(key.name)) {
      setFollowLogs(key.name === "end");
    }
    if (key.ctrl && key.name === "l") {
      if (!logPath) setError("Start a workflow to create its live log");
      setFollowLogs(true);
      logsRef.current?.scrollTo(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (state === "running") {
      if (key.name === "escape" || (key.ctrl && key.name === "c"))
        controllerRef.current?.abort();
      return;
    }
    if (key.name === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (key.name === "tab") {
      setFocus((current) => (current + 1) % 3);
    } else if (key.ctrl && key.name === "g") {
      void start();
    } else if (key.ctrl && key.name === "p") {
      void pasteReference();
    }
  });

  useEffect(() => {
    if (!followLogs) return;
    const timeout = setTimeout(
      () => logsRef.current?.scrollTo(Number.MAX_SAFE_INTEGER),
      0,
    );
    return () => clearTimeout(timeout);
  }, [currentLogPath, events.length, followLogs, logPath, logs.length]);

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text attributes={TextAttributes.BOLD}>Realistic Image Studio</text>
        <text attributes={TextAttributes.DIM}>
          {config
            ? `${config.mainAgent} → ${config.drawAgent} · max ${config.maxIterations ?? 3}`
            : "Not configured"}
        </text>
      </box>

      <box flexDirection="column" flexShrink={0}>
        <text attributes={TextAttributes.DIM}>
          Describe the subject, setting, composition, light, camera, and
          constraints
        </text>
        <box
          style={{ border: true, height: 7 }}
          borderColor={focus === 0 ? "cyan" : "gray"}
        >
          <textarea
            ref={promptRef}
            focused={focus === 0 && state !== "running"}
            placeholder="A realistic editorial portrait at golden hour..."
          />
        </box>
      </box>

      <box flexDirection="column" flexShrink={0}>
        <text attributes={TextAttributes.DIM}>
          Reference image paths (comma-separated; Ctrl+P reads clipboard image)
        </text>
        <box
          style={{ border: true, height: 3 }}
          borderColor={focus === 1 ? "cyan" : "gray"}
        >
          <textarea
            ref={referencesRef}
            focused={focus === 1 && state !== "running"}
            keyBindings={singleLineKeyBindings}
            placeholder="/path/to/reference.jpg"
          />
        </box>
      </box>

      <box
        flexDirection="column"
        borderStyle="rounded"
        borderColor={
          state === "failed"
            ? "red"
            : state === "completed"
              ? "green"
              : "yellow"
        }
        paddingLeft={1}
        paddingRight={1}
        flexGrow={1}
        minHeight={4}
      >
        <text attributes={TextAttributes.BOLD}>Workflow · {state}</text>
        <scrollbox
          ref={logsRef}
          focused={state === "running" || focus === 2}
          style={{
            flexGrow: 1,
            stickyScroll: true,
            stickyStart: "bottom",
            scrollbarOptions: { showArrows: true },
          }}
        >
          {activity.length === 0 ? (
            <text attributes={TextAttributes.DIM}>Waiting to launch.</text>
          ) : (
            activity.map((item, index) => (
              <text
                key={`${item.timestamp}-${index}`}
                wrapMode="char"
                style={{ fg: item.color, width: "100%" }}
              >
                {item.text}
              </text>
            ))
          )}
          {error && events.at(-1)?.message !== error ? (
            <text style={{ fg: "red" }}>{error}</text>
          ) : null}
          {images.map((path) => (
            <text key={path} style={{ fg: "green" }}>
              ✓ {path}
            </text>
          ))}
          {logPath ? (
            <>
              <text wrapMode="char" style={{ fg: "cyan", width: "100%" }}>
                Live log: {logPath}
              </text>
              <text wrapMode="char" style={{ fg: "cyan", width: "100%" }}>
                Follow: tail -F {currentLogPath}
              </text>
            </>
          ) : null}
        </scrollbox>
      </box>

      <text attributes={TextAttributes.DIM} flexShrink={0}>
        {state === "running"
          ? "↑/↓ PgUp/PgDn scroll · End follow · Ctrl+L log path · Esc cancel"
          : "Tab focus · ↑/↓ PgUp/PgDn scroll · End follow · Ctrl+L log path · Ctrl+G run · Esc back"}
      </text>
    </box>
  );
}
