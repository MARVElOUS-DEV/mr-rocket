import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { $ } from "bun";

/**
 * Saves clipboard image to a temp file and returns the path.
 * Returns null if no image in clipboard.
 */
export async function saveClipboardImage(): Promise<string | null> {
  const tempPath = join(tmpdir(), `mr-rocket-clipboard-${Date.now()}.png`);

  const script = `
    set theFile to POSIX file "${tempPath}"
    try
      set pngData to the clipboard as «class PNGf»
      set fileRef to open for access theFile with write permission
      write pngData to fileRef
      close access fileRef
      return "ok"
    on error
      return "no image"
    end try
  `;

  const result = await $`osascript -e ${script}`.text();

  if (result.trim() === "ok" && existsSync(tempPath)) {
    return tempPath;
  }

  return null;
}
