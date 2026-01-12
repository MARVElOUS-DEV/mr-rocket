import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { GitLabService } from "../services/gitlab.service.js";
import { ValidationError } from "./validation.js";

type TerminalImageReplacement = {
  text: string;
  tempFiles: string[];
};

const ITERM_PREFIX = "\u001b]1337;File=";
const ITERM_BEL = "\u0007";
const ESC = "\u001b";
const ST = `${ESC}\\`;
const KITTY_PREFIX = "\u001b_G";

export async function prepareDescriptionWithUploads(
  gitlab: GitLabService,
  projectId: number | string,
  description: string
): Promise<string> {
  const { text, tempFiles } = await replaceTerminalImagesWithMarkdown(description);
  const cleanupFiles: string[] = [...tempFiles];
  const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches = Array.from(text.matchAll(imageRegex));
  if (matches.length === 0) {
    await cleanupTempFiles(cleanupFiles);
    return text;
  }

  const uploadCache = new Map<string, string>();
  let updated = text;

  for (const match of matches) {
    const fullMatch = match[0];
    const altText = match[1] ?? "";
    const imagePath = match[2] ?? "";

    if (isRemoteImageReference(imagePath)) {
      continue;
    }

    let resolvedPath: string;
    if (imagePath.startsWith("data:")) {
      resolvedPath = await writeDataUriToTempFile(imagePath);
      cleanupFiles.push(resolvedPath);
    } else {
      resolvedPath = isAbsolute(imagePath)
        ? imagePath
        : resolve(process.cwd(), imagePath);
    }

    if (!existsSync(resolvedPath)) {
      throw new ValidationError(`Image file not found: ${resolvedPath}`);
    }

    const cacheKey = imagePath.startsWith("data:") ? imagePath : resolvedPath;
    const cachedUrl = uploadCache.get(cacheKey);
    const uploadUrl =
      cachedUrl ?? (await gitlab.uploadProjectFile(projectId, resolvedPath)).url;

    uploadCache.set(cacheKey, uploadUrl);
    const replacement = `![${altText}](${uploadUrl})`;
    updated = updated.replaceAll(fullMatch, replacement);
  }

  await cleanupTempFiles(cleanupFiles);
  return updated;
}

async function replaceTerminalImagesWithMarkdown(
  description: string
): Promise<TerminalImageReplacement> {
  const iterm = await replaceItermImages(description);
  const kitty = await replaceKittyImages(iterm.text, iterm.tempFiles);
  return kitty;
}

async function replaceItermImages(
  description: string
): Promise<TerminalImageReplacement> {
  let updated = description;
  const tempFiles: string[] = [];
  let searchIndex = 0;

  while (true) {
    const start = updated.indexOf(ITERM_PREFIX, searchIndex);
    if (start === -1) {
      break;
    }
    const { endIndex, terminatorLength } = findTerminator(updated, start);
    if (endIndex === -1) {
      break;
    }

    const payload = updated.slice(start + ITERM_PREFIX.length, endIndex);
    const separatorIndex = payload.indexOf(":");
    if (separatorIndex === -1) {
      searchIndex = endIndex + terminatorLength;
      continue;
    }

    const paramText = payload.slice(0, separatorIndex);
    const dataText = payload.slice(separatorIndex + 1);
    const params = parseParamList(paramText, ";");
    const fileName = decodeBase64Name(params.get("name"));
    const buffer = decodeBase64Buffer(dataText);
    if (buffer.length === 0) {
      searchIndex = endIndex + terminatorLength;
      continue;
    }

    const tempPath = await writeTempImageFile(buffer, fileName);
    tempFiles.push(tempPath);
    const altText = buildAltText(fileName, tempFiles.length);
    const markdown = `![${altText}](${tempPath})`;
    updated = updated.slice(0, start) + markdown + updated.slice(endIndex + terminatorLength);
    searchIndex = start + markdown.length;
  }

  return { text: updated, tempFiles };
}

async function replaceKittyImages(
  description: string,
  existingTempFiles: string[]
): Promise<TerminalImageReplacement> {
  let updated = description;
  const tempFiles = [...existingTempFiles];
  let searchIndex = 0;

  while (true) {
    const start = updated.indexOf(KITTY_PREFIX, searchIndex);
    if (start === -1) {
      break;
    }
    const endIndex = updated.indexOf(ST, start);
    if (endIndex === -1) {
      break;
    }

    const payload = updated.slice(start + KITTY_PREFIX.length, endIndex);
    const separatorIndex = payload.indexOf(";");
    if (separatorIndex === -1) {
      searchIndex = endIndex + ST.length;
      continue;
    }

    const paramText = payload.slice(0, separatorIndex);
    const dataText = payload.slice(separatorIndex + 1);
    const params = parseParamList(paramText, ",");
    if (params.get("m") === "1") {
      searchIndex = endIndex + ST.length;
      continue;
    }

    const buffer = decodeBase64Buffer(dataText);
    if (buffer.length === 0) {
      searchIndex = endIndex + ST.length;
      continue;
    }

    const tempPath = await writeTempImageFile(buffer);
    tempFiles.push(tempPath);
    const altText = buildAltText(undefined, tempFiles.length);
    const markdown = `![${altText}](${tempPath})`;
    updated = updated.slice(0, start) + markdown + updated.slice(endIndex + ST.length);
    searchIndex = start + markdown.length;
  }

  return { text: updated, tempFiles };
}

function findTerminator(
  text: string,
  startIndex: number
): { endIndex: number; terminatorLength: number } {
  const belIndex = text.indexOf(ITERM_BEL, startIndex);
  const stIndex = text.indexOf(ST, startIndex);

  if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
    return { endIndex: belIndex, terminatorLength: ITERM_BEL.length };
  }
  if (stIndex !== -1) {
    return { endIndex: stIndex, terminatorLength: ST.length };
  }
  return { endIndex: -1, terminatorLength: 0 };
}

function parseParamList(
  text: string,
  separator: string
): Map<string, string> {
  const params = new Map<string, string>();
  const parts = text.split(separator).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = part.slice(0, eqIndex);
    const value = part.slice(eqIndex + 1);
    params.set(key, value);
  }
  return params;
}

function decodeBase64Name(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

function decodeBase64Buffer(value: string): Buffer {
  const cleaned = value.replace(/\s+/g, "");
  if (!cleaned) {
    return Buffer.alloc(0);
  }
  return Buffer.from(cleaned, "base64");
}

async function writeDataUriToTempFile(dataUri: string): Promise<string> {
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUri);
  if (!match) {
    throw new ValidationError("Unsupported data URI image format");
  }
  const matchExtension = match[1];
  const matchBuffer = match[2];
  if (!matchExtension || !matchBuffer) {
    throw new ValidationError("Unsupported data URI image format");
  }
  const extension = normalizeExtension(matchExtension);
  const buffer = decodeBase64Buffer(matchBuffer);
  if (buffer.length === 0) {
    throw new ValidationError("Empty data URI image");
  }
  return writeTempImageFile(buffer, `pasted.${extension}`);
}

async function writeTempImageFile(
  buffer: Buffer,
  nameHint?: string
): Promise<string> {
  const safeName = sanitizeFilename(nameHint ?? "pasted-image");
  const extension = normalizeExtension(extname(safeName).slice(1)) || detectImageExtension(buffer);
  const baseName = safeName.replace(new RegExp(`\\.${extension}$`, "i"), "");
  const fileName = `${baseName || "pasted-image"}-${randomUUID()}.${extension}`;
  const filePath = join(tmpdir(), fileName);
  await writeFile(filePath, buffer);
  return filePath;
}

function detectImageExtension(buffer: Buffer): string {
  if (buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "png";
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      return "jpg";
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return "gif";
    }
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return "webp";
    }
  }
  return "png";
}

function normalizeExtension(extension: string): string {
  const cleaned = extension.toLowerCase();
  if (!cleaned) {
    return "";
  }
  if (cleaned === "jpeg") {
    return "jpg";
  }
  return cleaned;
}

function sanitizeFilename(name: string): string {
  const base = basename(name);
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildAltText(name: string | undefined, index: number): string {
  if (name) {
    const base = basename(name, extname(name));
    if (base) {
      return base;
    }
  }
  return `pasted-image-${index}`;
}

function isRemoteImageReference(pathValue: string): boolean {
  const trimmed = pathValue.trim();
  if (trimmed.startsWith("data:")) {
    return false;
  }
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/uploads/") ||
    trimmed.startsWith("/-/uploads/")
  );
}

async function cleanupTempFiles(paths: string[]): Promise<void> {
  const unique = Array.from(new Set(paths));
  await Promise.all(
    unique.map(async (pathValue) => {
      try {
        await unlink(pathValue);
      } catch {
        // Ignore cleanup failures.
      }
    })
  );
}
