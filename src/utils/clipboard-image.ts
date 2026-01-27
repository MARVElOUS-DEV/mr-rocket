import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { existsSync, copyFileSync } from "node:fs";
import { $ } from "bun";

/**
 * Saves clipboard image to a temp file and returns the path.
 * Handles both raw image data and file references from clipboard.
 * Returns null if no image in clipboard.
 */
export async function saveClipboardImage(): Promise<string | null> {
  const baseName = `mr-rocket-clipboard-${Date.now()}`;

  // First try to get file path from clipboard (when file is copied in Finder)
  const fileScript = `
    try
      set theFiles to the clipboard as «class furl»
      return POSIX path of theFiles
    on error
      return ""
    end try
  `;
  
  const filePath = (await $`osascript -e ${fileScript}`.text()).trim();
  if (filePath && existsSync(filePath) && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(filePath)) {
    const ext = extname(filePath).toLowerCase() || ".png";
    const tempPath = join(tmpdir(), `${baseName}${ext}`);
    copyFileSync(filePath, tempPath);
    return tempPath;
  }

  // Fall back to raw PNG data from clipboard
  const tempPath = join(tmpdir(), `${baseName}.png`);
  const pngScript = `
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

  const result = await $`osascript -e ${pngScript}`.text();

  if (result.trim() === "ok" && existsSync(tempPath)) {
    return tempPath;
  }

  return null;
}
