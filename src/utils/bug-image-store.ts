import { existsSync, mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const BUG_IMAGES_DIR = join(homedir(), ".mr-rocket", "images");

export type StoredBugImages = {
  bugId: string;
  images: StoredImage[];
};

export type StoredImage = {
  fileName: string;
  fullPath: string;
  mtimeMs: number;
};

function assertSafePathSegment(value: string, label: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error(`${label} contains invalid characters`);
  }
}

export function ensureBugDir(bugId: string): string {
  assertSafePathSegment(bugId, "Bug ID");
  const bugDir = join(BUG_IMAGES_DIR, bugId.trim());
  if (!existsSync(bugDir)) {
    mkdirSync(bugDir, { recursive: true });
  }
  return bugDir;
}

export function getNextSequence(existingFiles: string[]): string {
  let max = 0;
  for (const file of existingFiles) {
    const match = /^(\d+)\./.exec(file);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return String(max + 1).padStart(3, "0");
}

export function listStoredBugImages(): StoredBugImages[] {
  if (!existsSync(BUG_IMAGES_DIR)) return [];

  const bugs = readdirSync(BUG_IMAGES_DIR, { withFileTypes: true, encoding: "utf8" })
    .filter((d) => d.isDirectory())
    .map((d): StoredBugImages => {
      const bugId = d.name;
      const bugDir = join(BUG_IMAGES_DIR, bugId);
      const images = readdirSync(bugDir, { withFileTypes: true, encoding: "utf8" })
        .filter((e) => e.isFile())
        .map((e): StoredImage => {
          const fullPath = join(bugDir, e.name);
          const stat = statSync(fullPath);
          return { fileName: e.name, fullPath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
      return { bugId, images };
    })
    .filter((b) => b.images.length > 0)
    .sort((a, b) => a.bugId.localeCompare(b.bugId));

  return bugs;
}

export function cleanupOutdatedBugImages(retentionDays = 30): {
  deletedFiles: number;
  deletedDirs: number;
  errors: number;
} {
  if (!existsSync(BUG_IMAGES_DIR)) {
    return { deletedFiles: 0, deletedDirs: 0, errors: 0 };
  }

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deletedFiles = 0;
  let deletedDirs = 0;
  let errors = 0;

  const bugDirs = readdirSync(BUG_IMAGES_DIR, { withFileTypes: true, encoding: "utf8" }).filter(
    (d) => d.isDirectory(),
  );

  for (const dir of bugDirs) {
    const bugDir = join(BUG_IMAGES_DIR, dir.name);
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(bugDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      errors += 1;
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = join(bugDir, entry.name);
      try {
        const stat = statSync(fullPath);
        if (stat.mtimeMs < cutoffMs) {
          unlinkSync(fullPath);
          deletedFiles += 1;
        }
      } catch {
        errors += 1;
      }
    }

    try {
      const remaining = readdirSync(bugDir);
      if (remaining.length === 0) {
        rmdirSync(bugDir);
        deletedDirs += 1;
      }
    } catch {
      // ignore
    }
  }

  return { deletedFiles, deletedDirs, errors };
}

export function deleteBugImage(bugId: string, fileName: string): boolean {
  assertSafePathSegment(bugId, "Bug ID");
  assertSafePathSegment(fileName, "File name");
  const bugDir = join(BUG_IMAGES_DIR, bugId.trim());
  const fullPath = join(bugDir, fileName.trim());
  if (!existsSync(fullPath)) return false;

  unlinkSync(fullPath);

  try {
    const remaining = readdirSync(bugDir);
    if (remaining.length === 0) {
      rmdirSync(bugDir);
    }
  } catch {
    // ignore
  }

  return true;
}

