import type { CDPCookie, CDPSyncMessage } from "@mr-rocket/shared";

const CONFIG_KEY = "mrrocket_config";
const NATIVE_HOST = "com.mrrocket.auth";

interface Config {
  cdpDomain: string;
  syncInterval: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: Config = {
  cdpDomain: "your-cdp-domain.com",
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
        config = { ...DEFAULT_CONFIG, ...stored[CONFIG_KEY] };
      }
      console.log("🚀 ~ read config:", config)
      startCookieMonitor();
    })
    .catch((error) => {
      console.error("Failed to load config from storage:", error);
      startCookieMonitor();
    });
});

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
  
  const cookieDomain = changeInfo.cookie.domain.startsWith(".") 
    ? changeInfo.cookie.domain.substring(1) 
    : changeInfo.cookie.domain;
  const targetDomain = config.cdpDomain.startsWith(".") 
    ? config.cdpDomain.substring(1) 
    : config.cdpDomain;

  if (cookieDomain === targetDomain || cookieDomain.endsWith("." + targetDomain)) {
    console.log(
      `Cookie ${changeInfo.removed ? "removed" : "changed"}: ${changeInfo.cookie.name}`
    );
    syncCookies();
  }
}

async function syncCookies() {
  if (!config.enabled) return;

  try {
    const cookies = await chrome.cookies.getAll({ url: `https://${config.cdpDomain}` });

    if (cookies.length === 0) {
      updateBadge("!", "#FFA500");
      return;
    }

    const message: CDPSyncMessage = {
      type: "SYNC_COOKIES",
      timestamp: Date.now(),
      domain: config.cdpDomain,
      cookies: cookies.map(
        (c): CDPCookie => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
        })
      ),
    };

    sendToNativeHost(message);
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
        domain: config.cdpDomain,
        lastSync: lastSyncTime?.toISOString(),
        connected: port !== null,
      });
      break;

    case "UPDATE_CONFIG":
      const oldInterval = config.syncInterval;
      config = { ...config, ...message.config };
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
