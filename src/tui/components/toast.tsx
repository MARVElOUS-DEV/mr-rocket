import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import { getStore } from "../store.js";
import type { ToastType } from "../../types/tui.js";

const TOAST_COLORS: Record<ToastType, string> = {
  info: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
};

const TOAST_ICONS: Record<ToastType, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✗",
};

export function Toast() {
  const store = getStore();
  const [toast, setToast] = useState(store.getState().toast);

  useEffect(() => {
    return store.subscribe((state) => {
      setToast(state.toast);
    });
  }, []);

  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => {
        store.dispatch({ type: "HIDE_TOAST" });
      }, toast.duration ?? 3000);
      return () => clearTimeout(timeout);
    }
  }, [toast]);

  if (!toast) return null;

  const color = TOAST_COLORS[toast.type];
  const icon = TOAST_ICONS[toast.type];

  return (
    <box
      position="absolute"
      top={0}
      right={0}
      width={140}
      borderStyle="single"
      borderColor={color}
      paddingLeft={1}
      paddingRight={1}
    >
      <text style={{ fg: color }} attributes={TextAttributes.BOLD}>
        {icon} {toast.message}
      </text>
    </box>
  );
}

export function showToast(message: string, type: ToastType = "info", duration = 3000) {
  getStore().dispatch({ type: "SHOW_TOAST", toast: { message, type, duration } });
}
