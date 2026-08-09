import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface ImageWorkflowLogFile {
  path: string;
  currentPath: string;
  write(text: string): void;
  close(): Promise<void>;
}

export async function createImageWorkflowLog(
  directory = join(homedir(), ".mr-rocket", "logs"),
): Promise<ImageWorkflowLogFile> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const path = join(directory, `image-workflow-${timestamp}.log`);
  const currentPath = join(directory, "image-workflow-current.log");
  const stream = createWriteStream(path, {
    encoding: "utf8",
    flags: "wx",
    mode: 0o600,
  });
  await once(stream, "open");
  await chmod(path, 0o600);

  const temporaryLink = `${currentPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await symlink(basename(path), temporaryLink);
    await rename(temporaryLink, currentPath);
  } catch (error) {
    await unlink(temporaryLink).catch(() => {});
    stream.end();
    await once(stream, "close");
    throw error;
  }

  let closed = false;
  let streamError: Error | undefined;
  stream.on("error", (error) => {
    streamError = error;
  });

  return {
    path,
    currentPath,
    write(text) {
      if (!closed) stream.write(text);
    },
    async close() {
      if (closed) return;
      closed = true;
      stream.end();
      await once(stream, "close");
      if (streamError) throw streamError;
    },
  };
}
