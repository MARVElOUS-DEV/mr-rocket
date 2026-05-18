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
  switch (process.platform) {
    case "darwin":
      return saveClipboardImageMac();
    case "win32":
      return saveClipboardImageWindows();
    default:
      return null;
  }
}

async function saveClipboardImageMac(): Promise<string | null> {
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

async function saveClipboardImageWindows(): Promise<string | null> {
  const baseName = `mr-rocket-clipboard-${Date.now()}`;
  const tempPath = join(tmpdir(), `${baseName}.png`).replace(/\\/g, "\\\\");

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$files = [System.Windows.Forms.Clipboard]::GetFileDropList()
if ($files.Count -gt 0) {
  $f = $files[0]
  if ($f -match '\\.(png|jpg|jpeg|gif|webp|bmp)$') {
    Write-Output "FILE:$f"
    exit
  }
}
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $img.Save("${tempPath}", [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "OK"
} else {
  Write-Output "NONE"
}
`;

  const result = (await $`powershell -NoProfile -Command ${psScript}`.text()).trim();

  if (result.startsWith("FILE:")) {
    const filePath = result.slice(5);
    if (existsSync(filePath)) {
      const ext = extname(filePath).toLowerCase() || ".png";
      const destPath = join(tmpdir(), `${baseName}${ext}`);
      copyFileSync(filePath, destPath);
      return destPath;
    }
  } else if (result === "OK") {
    const actualPath = tempPath.replace(/\\\\/g, "\\");
    if (existsSync(actualPath)) {
      return actualPath;
    }
  }
  return null;
}
