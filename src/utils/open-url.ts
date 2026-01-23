import { spawn } from "node:child_process";

type OpenUrlResult = {
  ok: boolean;
  error?: string;
};

export function openUrl(url: string): OpenUrlResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing URL" };
  }

  let command: string;
  let args: string[];

  if (process.platform === "darwin") {
    command = "open";
    args = [trimmed];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", trimmed];
  } else {
    command = "xdg-open";
    args = [trimmed];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
