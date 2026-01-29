import type { CDPCookie, CDPSyncMessage } from "@mr-rocket/shared";

const CONFIG_KEY = "mrrocket_config";
const NATIVE_HOST = "com.mrrocket.auth";

interface Config {
  cdpDomains: string[];
  syncInterval: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: Config = {
  cdpDomains: ["your-cdp-domain.com"],
  syncInterval: 60 * 60 * 1000, // 1 hour
  enabled: true,
};

let config = DEFAULT_CONFIG;
let port: chrome.runtime.Port | null = null;
let lastSyncTime: Date | null = null;

let syncInterval: Timer | null = null;

export default defineBackground(() => {
  chrome.storage.local
    .get(CONFIG_KEY)
    .then((stored) => {
      if (stored[CONFIG_KEY]) {
        const storedConfig = stored[CONFIG_KEY] as Record<string, unknown>;
        const enabled =
          typeof storedConfig.enabled === "boolean"
            ? storedConfig.enabled
            : DEFAULT_CONFIG.enabled;
        const syncInterval =
          typeof storedConfig.syncInterval === "number"
            ? storedConfig.syncInterval
            : DEFAULT_CONFIG.syncInterval;

        const rawDomains =
          Array.isArray(storedConfig.cdpDomains)
            ? storedConfig.cdpDomains
            : typeof storedConfig.cdpDomain === "string"
              ? [storedConfig.cdpDomain]
              : DEFAULT_CONFIG.cdpDomains;

        config = {
          ...DEFAULT_CONFIG,
          enabled,
          syncInterval,
          cdpDomains: normalizeDomainList(rawDomains),
        };
      }
      console.log("[mr-rocket/auth] loaded config:", config);
      startCookieMonitor();
    })
    .catch((error) => {
      console.error("Failed to load config from storage:", error);
      startCookieMonitor();
    });
});

function sanitizeDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    const hostname = url.hostname.trim().toLowerCase();
    return hostname.length > 0 ? hostname : null;
  } catch {
    const fallback = trimmed.split("/")[0] ?? "";
    const normalized = fallback.trim().replace(/^\./, "").toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }
}

function normalizeDomainList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const domain = sanitizeDomain(item);
    if (!domain) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

function startCookieMonitor() {
  chrome.cookies.onChanged.addListener(handleCookieChange);
  syncCookies();
  restartInterval();
}

function restartInterval() {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  syncInterval = setInterval(syncCookies, config.syncInterval);
}

function handleCookieChange(changeInfo: chrome.cookies.CookieChangeInfo) {
  if (!config.enabled) return;

  const cookieDomain = sanitizeDomain(changeInfo.cookie.domain) || "";
  const targets = normalizeDomainList(config.cdpDomains);
  const affected = targets.filter(
    (target) => target === cookieDomain || target.endsWith(`.${cookieDomain}`),
  );

  if (affected.length > 0) {
    console.log(
      `[mr-rocket/auth] cookie ${changeInfo.removed ? "removed" : "changed"}: ${changeInfo.cookie.name}`,
    );
    syncCookies(affected);
  }
}

async function syncCookies(domainsOverride?: string[]) {
  if (!config.enabled) return;

  try {
    const domains = normalizeDomainList(domainsOverride ?? config.cdpDomains);
    if (domains.length === 0) {
      updateBadge("!", "#FFA500");
      return;
    }

    let sent = 0;
    for (const domain of domains) {
      const cookies = await chrome.cookies.getAll({ url: `https://${domain}` });
      if (cookies.length === 0) {
        continue;
      }

      const message: CDPSyncMessage = {
        type: "SYNC_COOKIES",
        timestamp: Date.now(),
        domain,
        cookies: cookies.map(
          (c): CDPCookie => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            expirationDate: c.expirationDate,
            sameSite: c.sameSite,
            hostOnly: c.hostOnly,
            session: c.session,
            storeId: c.storeId,
            priority: (c as any).priority,
            sameParty: (c as any).sameParty,
            partitionKey: (c as any).partitionKey,
          }),
        ),
      };

      sendToNativeHost(message);
      sent += 1;
    }

    if (sent === 0) {
      updateBadge("!", "#FFA500");
      return;
    }

    lastSyncTime = new Date();
    updateBadge("✓", "#4CAF50");
  } catch (error) {
    console.error("Failed to sync cookies:", error);
    updateBadge("✗", "#F44336");
  }
}

function connectNativeHost(): chrome.runtime.Port | null {
  if (port) return port;

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);

    port.onMessage.addListener((message) => {
      console.log("Native host response:", message);
      if (message.type === "ACK") {
        updateBadge("✓", "#4CAF50");
      }
    });

    port.onDisconnect.addListener(() => {
      console.log(
        "Native host disconnected:",
        chrome.runtime.lastError?.message
      );
      port = null;
      updateBadge("✗", "#F44336");
    });

    return port;
  } catch (error) {
    console.error("Failed to connect native host:", error);
    return null;
  }
}

function sendToNativeHost(message: CDPSyncMessage) {
  const nativePort = connectNativeHost();
  if (nativePort) {
    nativePort.postMessage(message);
  }
}

function updateBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "GET_STATUS":
      sendResponse({
        enabled: config.enabled,
        domains: config.cdpDomains,
        lastSync: lastSyncTime?.toISOString(),
        connected: port !== null,
      });
      break;

    case "UPDATE_CONFIG":
      const oldInterval = config.syncInterval;

      const incoming =
        message && typeof message === "object" ? (message.config as any) : {};
      const nextEnabled =
        typeof incoming?.enabled === "boolean" ? incoming.enabled : config.enabled;
      const nextSyncInterval =
        typeof incoming?.syncInterval === "number"
          ? incoming.syncInterval
          : config.syncInterval;

      const nextDomainsRaw = Array.isArray(incoming?.cdpDomains)
        ? incoming.cdpDomains
        : typeof incoming?.cdpDomain === "string"
          ? [incoming.cdpDomain]
          : config.cdpDomains;

      config = {
        ...config,
        enabled: nextEnabled,
        syncInterval: nextSyncInterval,
        cdpDomains: normalizeDomainList(nextDomainsRaw),
      };

      chrome.storage.local.set({ [CONFIG_KEY]: config }).catch((error) => {
        console.error("Failed to save config to storage:", error);
      });
      if (config.syncInterval !== oldInterval) {
        restartInterval();
      }
      sendResponse({ success: true });
      break;

    case "FORCE_SYNC":
      syncCookies().then(() => {
        sendResponse({ success: true });
      });
      return true;
  }
  return true;
});
