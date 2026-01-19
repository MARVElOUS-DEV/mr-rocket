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
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

const MR_ROCKET_DIR = join(homedir(), ".mr-rocket");
const AUTH_FILE = join(MR_ROCKET_DIR, "cdp-auth.json");
const LOG_FILE = join(MR_ROCKET_DIR, "native-host.log");
const ENCRYPTION_KEY = `mr-rocket-cdp-${homedir()}`;

interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

interface SyncMessage {
  type: "SYNC_COOKIES";
  timestamp: number;
  domain: string;
  cookies: CDPCookie[];
}

interface AckMessage {
  type: "ACK";
  success: boolean;
  cookieCount: number;
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

function encrypt(data: string): string {
  const key = scryptSync(ENCRYPTION_KEY, "salt", 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

async function readMessage(): Promise<SyncMessage | null> {
  const reader = Bun.stdin.stream().getReader();
  try {
    // Chrome sends: 4-byte length (little-endian) + JSON message in one or more chunks
    const firstRead = await reader.read();

    if (!firstRead.value || firstRead.value.length < 4) {
      await log("Failed to read length header");
      return null;
    }

    const fullData = firstRead.value;
    const messageLength = new DataView(
      fullData.buffer,
      fullData.byteOffset,
      4,
    ).getUint32(0, true);

    await log(
      `Message length: ${messageLength}, received bytes: ${fullData.length}`,
    );

    if (messageLength === 0 || messageLength > 1024 * 1024) {
      await log(`Invalid message length: ${messageLength}`);
      return null;
    }

    let messageData: Uint8Array;
    if (fullData.length >= 4 + messageLength) {
      // All data in first chunk
      messageData = fullData.subarray(4, 4 + messageLength);
    } else {
      // Need to read more chunks
      const chunks = [fullData.subarray(4)];
      let totalRead = fullData.length - 4;

      while (totalRead < messageLength) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        totalRead += value.length;
      }

      messageData = new Uint8Array(messageLength);
      let offset = 0;
      for (const chunk of chunks) {
        const toCopy = Math.min(chunk.length, messageLength - offset);
        messageData.set(chunk.subarray(0, toCopy), offset);
        offset += toCopy;
      }
    }

    const messageText = new TextDecoder().decode(messageData);
    await log(`Received: ${messageText.substring(0, 200)}...`);
    return JSON.parse(messageText) as SyncMessage;
  } catch (error) {
    await log(`Error reading message: ${error}`);
    return null;
  } finally {
    reader.releaseLock();
  }
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

  const authData = {
    timestamp: message.timestamp,
    domain: message.domain,
    cookies: message.cookies,
    syncedAt: new Date().toISOString(),
  };

  const encrypted = encrypt(JSON.stringify(authData));
  const wrapper = {
    encrypted: true,
    data: encrypted,
  };

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
  });
}

async function main(): Promise<void> {
  await log("Native host started");

  try {
    const message = await readMessage();

    if (!message) {
      await log("No message received or failed to parse");
      writeMessage({ type: "ERROR", error: "Failed to read message" });
      return;
    }

    if (message.type === "SYNC_COOKIES") {
      await handleSyncCookies(message);
    } else {
      await log(`Unknown message type: ${message.type}`);
      writeMessage({ type: "ERROR", error: "Unknown message type" });
    }
  } catch (error) {
    await log(`Error: ${error}`);
    writeMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await log("Native host finished");
}

main();
