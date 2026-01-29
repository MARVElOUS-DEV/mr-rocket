#!/usr/bin/env bun
/**
 * Native Messaging Host for MR-Rocket Chrome Extension
 *
 * This script receives cookie data from the Chrome extension via native messaging
 * and writes it encrypted to ~/.mr-rocket/cdp-auth.json
 *
 * Native messaging protocol:
 * - First 4 bytes: message length (little-endian uint32)
 * - Remaining bytes: JSON message
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, chmodSync } from "node:fs";
import {
  wrapEncryptedCdpAuthData,
  readCdpAuthData,
  DEFAULT_CDP_AUTH_FILE_PATH,
} from "../src/utils/cdp-auth";
import type { CDPAuthData, CDPCookie, CDPSiteAuthData, CDPSyncMessage } from "@mr-rocket/shared";

const MR_ROCKET_DIR = join(homedir(), ".mr-rocket");
const AUTH_FILE = DEFAULT_CDP_AUTH_FILE_PATH;
const LOG_FILE = join(MR_ROCKET_DIR, "native-host.log");

type SyncMessage = CDPSyncMessage;

interface AckMessage {
  type: "ACK";
  success: boolean;
  cookieCount: number;
  domain?: string;
}

interface ErrorMessage {
  type: "ERROR";
  error: string;
}

import { appendFile } from "node:fs/promises";

async function log(message: string): Promise<void> {
  const timestamp = new Date().toLocaleString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    await appendFile(LOG_FILE, line);
  } catch {
    // Ignore log errors
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^\./, "").toLowerCase();
}

function asAuthV2(existing: CDPAuthData | undefined): {
  version: 2;
  sites: Record<string, CDPSiteAuthData>;
} {
  const sites: Record<string, CDPSiteAuthData> = {};
  if (!existing) {
    return { version: 2, sites };
  }

  if ((existing as any).version === 2) {
    const v2 = existing as { version: 2; sites: Record<string, CDPSiteAuthData> };
    for (const [key, value] of Object.entries(v2.sites ?? {})) {
      const normalizedKey = normalizeDomain(value.domain || key);
      sites[normalizedKey] = value;
    }
    return { version: 2, sites };
  }

  const v1 = existing as CDPSiteAuthData;
  sites[normalizeDomain(v1.domain)] = v1;
  return { version: 2, sites };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function isSyncMessage(value: unknown): value is SyncMessage {
  if (!value || typeof value !== "object") return false;
  const anyValue = value as Record<string, unknown>;
  return (
    anyValue.type === "SYNC_COOKIES" &&
    typeof anyValue.timestamp === "number" &&
    typeof anyValue.domain === "string" &&
    Array.isArray(anyValue.cookies)
  );
}

function writeMessage(message: AckMessage | ErrorMessage): void {
  const json = JSON.stringify(message);
  const messageBuffer = new TextEncoder().encode(json);
  const lengthBuffer = new Uint8Array(4);
  new DataView(lengthBuffer.buffer).setUint32(0, messageBuffer.length, true);

  process.stdout.write(Buffer.from(lengthBuffer));
  process.stdout.write(Buffer.from(messageBuffer));
}

async function handleSyncCookies(message: SyncMessage): Promise<void> {
  await log(
    `Received ${message.cookies.length} cookies for domain: ${message.domain}`,
  );

  if (!existsSync(MR_ROCKET_DIR)) {
    await mkdir(MR_ROCKET_DIR, { recursive: true });
  }

  let existing: CDPAuthData | undefined;
  try {
    existing = await readCdpAuthData({ authFilePath: AUTH_FILE });
  } catch (error) {
    await log(
      `Failed to read existing auth file, overwriting: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const authData = asAuthV2(existing);
  const domainKey = normalizeDomain(message.domain);
  authData.sites[domainKey] = {
    timestamp: message.timestamp,
    domain: domainKey,
    cookies: message.cookies,
    syncedAt: new Date().toISOString(),
  };

  const wrapper = wrapEncryptedCdpAuthData(authData);

  await writeFile(AUTH_FILE, JSON.stringify(wrapper, null, 2), "utf-8");

  // Set file permissions to owner-only (600)
  try {
    chmodSync(AUTH_FILE, 0o600);
  } catch {
    // Ignore chmod errors on Windows
  }

  await log(`Saved ${message.cookies.length} cookies to ${AUTH_FILE}`);

  writeMessage({
    type: "ACK",
    success: true,
    cookieCount: message.cookies.length,
    domain: domainKey,
  });
}

async function main(): Promise<void> {
  await log("Native host started");

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      buffer = concatBytes(buffer, value);

      while (buffer.length >= 4) {
        const messageLength = new DataView(
          buffer.buffer,
          buffer.byteOffset,
          4,
        ).getUint32(0, true);

        if (messageLength === 0 || messageLength > 1024 * 1024) {
          await log(`Invalid message length: ${messageLength}`);
          writeMessage({ type: "ERROR", error: "Invalid message length" });
          return;
        }

        if (buffer.length < 4 + messageLength) {
          break;
        }

        const messageData = buffer.subarray(4, 4 + messageLength);
        buffer = buffer.subarray(4 + messageLength);

        const messageText = decoder.decode(messageData);

        let parsed: unknown;
        try {
          parsed = JSON.parse(messageText) as unknown;
        } catch (error) {
          await log(
            `Failed to parse JSON message: ${error instanceof Error ? error.message : String(error)}`,
          );
          writeMessage({ type: "ERROR", error: "Invalid JSON" });
          continue;
        }

        if (!isSyncMessage(parsed)) {
          const type =
            parsed && typeof parsed === "object"
              ? String((parsed as any).type)
              : "unknown";
          await log(`Unknown message type: ${type}`);
          writeMessage({ type: "ERROR", error: "Unknown message type" });
          continue;
        }

        await handleSyncCookies(parsed);
      }
    }
  } catch (error) {
    await log(`Error: ${error}`);
    writeMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    reader.releaseLock();
  }

  await log("Native host finished");
}

main();
