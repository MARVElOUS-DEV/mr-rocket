import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CDPAuthData, CDPSiteAuthData } from "@mr-rocket/shared";

export type CdpAuthFileWrapper = {
  encrypted?: boolean;
  data: string;
};

export const DEFAULT_CDP_AUTH_FILE_PATH = join(
  homedir(),
  ".mr-rocket",
  "cdp-auth.json",
);

export function getDefaultCdpEncryptionKeyMaterial(): string {
  return `mr-rocket-cdp-${homedir()}`;
}

function deriveAesKey(keyMaterial: string): Buffer {
  return scryptSync(keyMaterial, "salt", 32);
}

export function encryptCdpAuthPayload(
  plaintext: string,
  options: { keyMaterial?: string } = {},
): string {
  const keyMaterial =
    options.keyMaterial ?? getDefaultCdpEncryptionKeyMaterial();
  const key = deriveAesKey(keyMaterial);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptCdpAuthPayload(
  payload: string,
  options: { keyMaterial?: string } = {},
): string {
  const keyMaterial =
    options.keyMaterial ?? getDefaultCdpEncryptionKeyMaterial();

  const parts = payload.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid encrypted data format: missing IV or ciphertext");
  }

  const [ivHex, encrypted] = parts;
  const key = deriveAesKey(keyMaterial);
  const iv = Buffer.from(ivHex!, "hex");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted!, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function wrapEncryptedCdpAuthData(
  authData: CDPAuthData,
  options: { keyMaterial?: string } = {},
): CdpAuthFileWrapper {
  return {
    encrypted: true,
    data: encryptCdpAuthPayload(JSON.stringify(authData), options),
  };
}

export async function readCdpAuthFileWrapper(
  options: { authFilePath?: string; required?: boolean } = {},
): Promise<CdpAuthFileWrapper | undefined> {
  const authFilePath = options.authFilePath ?? DEFAULT_CDP_AUTH_FILE_PATH;

  if (!existsSync(authFilePath)) {
    if (options.required) {
      throw new Error(
        `CDP auth file not found at ${authFilePath}. ` +
          "Please install the Chrome extension and log into CDP.",
      );
    }
    return undefined;
  }

  const content = await readFile(authFilePath, "utf-8");
  const wrapper = JSON.parse(content) as unknown;
  if (!wrapper || typeof wrapper !== "object") {
    throw new Error("Invalid cdp-auth.json format");
  }

  const anyWrapper = wrapper as Record<string, unknown>;
  if (typeof anyWrapper.data !== "string") {
    throw new Error("Invalid cdp-auth.json format");
  }

  return {
    encrypted:
      typeof anyWrapper.encrypted === "boolean" ? anyWrapper.encrypted : false,
    data: anyWrapper.data,
  };
}

export async function readCdpAuthData(
  options: {
    authFilePath?: string;
    keyMaterial?: string;
    required?: boolean;
  } = {},
): Promise<CDPAuthData | undefined> {
  const wrapper = await readCdpAuthFileWrapper({
    authFilePath: options.authFilePath,
    required: options.required,
  });
  if (!wrapper) {
    return undefined;
  }

  const json = wrapper.encrypted
    ? decryptCdpAuthPayload(wrapper.data, { keyMaterial: options.keyMaterial })
    : wrapper.data;

  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid CDP auth data structure");
  }

  const anyData = parsed as Record<string, unknown>;
  const version = anyData.version;

  if (version === 2) {
    const sites = anyData.sites;
    if (!sites || typeof sites !== "object") {
      throw new Error("Invalid CDP auth data structure");
    }

    for (const value of Object.values(sites as Record<string, unknown>)) {
      if (!isSiteAuthData(value)) {
        throw new Error("Invalid CDP auth data structure");
      }
    }

    return parsed as CDPAuthData;
  }

  if (!isSiteAuthData(anyData)) {
    throw new Error("Invalid CDP auth data structure");
  }

  return parsed as CDPAuthData;
}

function isSiteAuthData(value: unknown): value is CDPSiteAuthData {
  if (!value || typeof value !== "object") return false;
  const anyValue = value as Record<string, unknown>;
  return (
    typeof anyValue.timestamp === "number" &&
    typeof anyValue.domain === "string" &&
    typeof anyValue.syncedAt === "string" &&
    Array.isArray(anyValue.cookies)
  );
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^\./, "").toLowerCase();
}

function tryGetHostname(host: string): string | undefined {
  const trimmed = host.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    // Accept raw hostname without scheme
    return normalizeDomain(trimmed);
  }
}

export function selectCdpSiteAuthData(
  authData: CDPAuthData,
  options: { host?: string; domain?: string } = {},
): CDPSiteAuthData | undefined {
  if (!authData || typeof authData !== "object") return undefined;

  if ((authData as any).version === 2) {
    const v2 = authData as { version: 2; sites: Record<string, CDPSiteAuthData> };
    const sites = v2.sites ?? {};
    const keys = Object.keys(sites);
    if (keys.length === 0) return undefined;

    const requestedDomain = options.domain?.trim()
      ? normalizeDomain(options.domain)
      : undefined;
    const hostname = options.host?.trim() ? tryGetHostname(options.host) : undefined;

    const candidateTarget = requestedDomain ?? hostname;
    if (candidateTarget) {
      // Exact match first
      const exact = sites[normalizeDomain(candidateTarget)];
      if (exact) return exact;

      // Fallback: best suffix match (e.g., host=cdp.foo.com matches key=foo.com)
      let best: CDPSiteAuthData | undefined;
      let bestKeyLen = -1;
      for (const key of keys) {
        const normalizedKey = normalizeDomain(key);
        if (
          candidateTarget === normalizedKey ||
          candidateTarget.endsWith(`.${normalizedKey}`)
        ) {
          if (normalizedKey.length > bestKeyLen) {
            bestKeyLen = normalizedKey.length;
            best = sites[key];
          }
        }
      }
      if (best) return best;
    }

    // Last resort: pick most recent site
    let newest: CDPSiteAuthData | undefined;
    for (const site of Object.values(sites)) {
      if (!newest || site.timestamp > newest.timestamp) {
        newest = site;
      }
    }
    return newest;
  }

  // V1
  return authData as CDPSiteAuthData;
}

export async function getCdpCookieValueFromAuthFile(
  cookieName: string,
  options: {
    authFilePath?: string;
    keyMaterial?: string;
    host?: string;
    domain?: string;
  } = {},
): Promise<string | undefined> {
  let authData: CDPAuthData | undefined;
  try {
    authData = await readCdpAuthData({
      authFilePath: options.authFilePath,
      keyMaterial: options.keyMaterial,
    });
  } catch {
    return undefined;
  }
  if (!authData) return undefined;

  const site = selectCdpSiteAuthData(authData, {
    host: options.host,
    domain: options.domain,
  });
  if (!site) return undefined;

  const target = cookieName.toLowerCase();
  const value = site.cookies.find((c) => c?.name?.toLowerCase() === target)
    ?.value;
  return value && value.length > 0 ? value : undefined;
}
