import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { CDPService } from "../../services/cdp.service.js";
import { configManager } from "../../core/config-manager.js";
import { getStore } from "../store.js";
import { showToast } from "./toast.js";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function BugComment() {
  const store = getStore();
  const [bugLabelId, setBugLabelId] = useState("");
  const [reason, setReason] = useState("");
  const [solution, setSolution] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const focusCount = 3;

  const pasteImage = async () => {
    if (!bugLabelId) {
      setMessage("Enter Bug Label ID first");
      return;
    }
    setMessage("Uploading clipboard image...");
    try {
      const config = configManager.getConfig();
      if (!config.cdp) throw new Error("CDP not configured");
      const service = new CDPService(config.cdp);
      const { data: { fieldMap: bug  } } = await service.getBug(bugLabelId);
      const url = await service.uploadClipboardImage(bug.id);
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
    if (!bugLabelId || !reason || !solution) {
      setMessage("All fields required");
      return;
    }

    setStatus("submitting");
    setMessage(null);

    try {
      const config = configManager.getConfig();
      if (!config.cdp) throw new Error("CDP not configured");
      const service = new CDPService(config.cdp);
      const { data: { fieldMap:  bug  } } = await service.getBug(bugLabelId);
      await service.createComment(bug, reason, solution, imageUrls);
      setStatus("success");
      setMessage(`Comment created for bug ${bugLabelId}`);
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
      setFocusIndex((current) => (current + direction + focusCount) % focusCount);
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Create Bug Comment</text>
      <text attributes={TextAttributes.DIM}>Ctrl+S submit · Ctrl+P paste image · Tab move · Esc back</text>

      {message && <text color={status === "error" ? "red" : status === "success" ? "green" : "yellow"}>{message}</text>}

      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Bug Label ID</text>
          <box style={{ border: true, height: 3 }}>
            <input value={bugLabelId} onInput={setBugLabelId} placeholder="e.g. BUG-12345" focused={focusIndex === 0} />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>原因 (Reason)</text>
          <box style={{ border: true, height: 3 }}>
            <input value={reason} onInput={setReason} placeholder="Bug cause" focused={focusIndex === 1} />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>解决方案 (Solution)</text>
          <box style={{ border: true, height: 3 }}>
            <input value={solution} onInput={setSolution} placeholder="How it was fixed" focused={focusIndex === 2} />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Images ({imageUrls.length} uploaded) - Ctrl+P to paste from clipboard</text>
          {imageUrls.length > 0 && (
            <box flexDirection="column">
              {imageUrls.map((url, i) => (
                <text key={i} attributes={TextAttributes.DIM}>  {i + 1}. {url.slice(0, 50)}...</text>
              ))}
            </box>
          )}
        </box>
      </box>

      {status === "submitting" && <text attributes={TextAttributes.DIM}>Creating comment...</text>}
    </box>
  );
}
