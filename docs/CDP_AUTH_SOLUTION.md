# CDP Service Authentication Solution

## Problem Statement

The CDP (internal bug tracking) system:
- Does NOT support PAT (Personal Access Token) authentication
- Only supports username/password login via web UI
- Does NOT allow multiple concurrent sessions (new login kicks out existing session)

## Solution: Chrome Extension + Native Messaging

A Chrome extension that automatically syncs authentication cookies from the user's logged-in browser session to the CLI tool.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           User's Chrome Browser                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              MR-Rocket Auth Extension                                 │  │
│  │  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐  │  │
│  │  │ Background      │    │ Popup UI         │    │ Cookie Monitor  │  │  │
│  │  │ Service Worker  │◄───│ (Status/Config)  │    │ (chrome.cookies)│  │  │
│  │  └────────┬────────┘    └──────────────────┘    └────────┬────────┘  │  │
│  │           │                                              │           │  │
│  │           └──────────────────┬───────────────────────────┘           │  │
│  │                              ▼                                       │  │
│  │                    Native Messaging Host                             │  │
│  └──────────────────────────────┼───────────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │ JSON messages (stdin/stdout)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Native Messaging Host (Bun script)                       │
│  - Receives cookies from extension                                          │
│  - Writes encrypted auth data to ~/.mr-rocket/cdp-auth.json                │
│  - Validates and refreshes auth state                                       │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │ File I/O
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MR-Rocket CLI/TUI                                   │
│  - CDPService reads auth from ~/.mr-rocket/cdp-auth.json                   │
│  - Makes authenticated HTTP requests to CDP API                             │
│  - Falls back to browser automation if auth expired                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Chrome Extension Structure

```
extensions/mr-rocket-auth/
├── manifest.json           # Extension manifest (v3)
├── background.js           # Service worker for cookie monitoring
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Popup styles
│   └── popup.js            # Popup logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── native-messaging/
    └── com.mrrocket.auth.json  # Native messaging host manifest
```

#### manifest.json
```json
{
  "manifest_version": 3,
  "name": "MR-Rocket Auth Helper",
  "version": "1.0.0",
  "description": "Syncs CDP authentication for MR-Rocket CLI",
  "permissions": [
    "cookies",
    "nativeMessaging",
    "storage"
  ],
  "host_permissions": [
    "https://*.your-cdp-domain.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

#### background.js (Service Worker)
```javascript
// Configuration - user can modify via popup
const CONFIG_KEY = 'mrrocket_config';
const DEFAULT_CONFIG = {
  cdpDomain: 'your-cdp-domain.com',
  syncInterval: 60000, // 1 minute
  enabled: true
};

// Native messaging host name
const NATIVE_HOST = 'com.mrrocket.auth';

// State
let config = DEFAULT_CONFIG;
let port = null;
let lastSyncTime = null;

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  if (stored[CONFIG_KEY]) {
    config = { ...DEFAULT_CONFIG, ...stored[CONFIG_KEY] };
  }
  startCookieMonitor();
});

// Start monitoring cookies
function startCookieMonitor() {
  // Listen for cookie changes
  chrome.cookies.onChanged.addListener(handleCookieChange);
  
  // Initial sync
  syncCookies();
  
  // Periodic sync
  setInterval(syncCookies, config.syncInterval);
}

// Handle cookie changes for CDP domain
function handleCookieChange(changeInfo) {
  if (!config.enabled) return;
  
  const cookie = changeInfo.cookie;
  if (cookie.domain.includes(config.cdpDomain)) {
    console.log(`Cookie ${changeInfo.removed ? 'removed' : 'changed'}: ${cookie.name}`);
    syncCookies();
  }
}

// Sync all CDP cookies to native host
async function syncCookies() {
  if (!config.enabled) return;
  
  try {
    const cookies = await chrome.cookies.getAll({
      domain: config.cdpDomain
    });
    
    if (cookies.length === 0) {
      updateBadge('!', '#FFA500'); // Orange - no cookies
      return;
    }
    
    // Send to native messaging host
    sendToNativeHost({
      type: 'SYNC_COOKIES',
      timestamp: Date.now(),
      domain: config.cdpDomain,
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate
      }))
    });
    
    lastSyncTime = new Date();
    updateBadge('✓', '#4CAF50'); // Green - synced
    
  } catch (error) {
    console.error('Failed to sync cookies:', error);
    updateBadge('✗', '#F44336'); // Red - error
  }
}

// Connect to native messaging host
function connectNativeHost() {
  if (port) return port;
  
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    
    port.onMessage.addListener((message) => {
      console.log('Native host response:', message);
      if (message.type === 'ACK') {
        updateBadge('✓', '#4CAF50');
      }
    });
    
    port.onDisconnect.addListener(() => {
      console.log('Native host disconnected:', chrome.runtime.lastError?.message);
      port = null;
      updateBadge('✗', '#F44336');
    });
    
    return port;
  } catch (error) {
    console.error('Failed to connect native host:', error);
    return null;
  }
}

// Send message to native host
function sendToNativeHost(message) {
  const nativePort = connectNativeHost();
  if (nativePort) {
    nativePort.postMessage(message);
  } else {
    // Fallback: use one-time message
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Native message failed:', chrome.runtime.lastError);
      }
    });
  }
}

// Update extension badge
function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATUS':
      sendResponse({
        enabled: config.enabled,
        domain: config.cdpDomain,
        lastSync: lastSyncTime?.toISOString(),
        connected: port !== null
      });
      break;
      
    case 'UPDATE_CONFIG':
      config = { ...config, ...message.config };
      chrome.storage.local.set({ [CONFIG_KEY]: config });
      sendResponse({ success: true });
      break;
      
    case 'FORCE_SYNC':
      syncCookies();
      sendResponse({ success: true });
      break;
  }
  return true;
});
```

#### popup/popup.html
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <h1>🚀 MR-Rocket Auth</h1>
    
    <div class="status-section">
      <div class="status-row">
        <span>Status:</span>
        <span id="status" class="status-badge">--</span>
      </div>
      <div class="status-row">
        <span>Last Sync:</span>
        <span id="lastSync">Never</span>
      </div>
    </div>
    
    <div class="config-section">
      <label>
        CDP Domain:
        <input type="text" id="domain" placeholder="your-cdp-domain.com">
      </label>
      
      <label class="toggle">
        <input type="checkbox" id="enabled">
        <span>Enable Auto-Sync</span>
      </label>
    </div>
    
    <div class="actions">
      <button id="syncNow" class="btn primary">Sync Now</button>
      <button id="saveConfig" class="btn">Save Config</button>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

---

### 2. Native Messaging Host

Location: `~/.mr-rocket/native-host/`

#### com.mrrocket.auth.json (Host Manifest)
```json
{
  "name": "com.mrrocket.auth",
  "description": "MR-Rocket Auth Native Messaging Host",
  "path": "/Users/caesar/.mr-rocket/native-host/host.js",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
```

#### host.js (Bun Script)
```typescript
#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const CONFIG_DIR = join(homedir(), '.mr-rocket');
const AUTH_FILE = join(CONFIG_DIR, 'cdp-auth.json');
const ENCRYPTION_KEY = 'mr-rocket-cdp-auth-key'; // In production, use machine-specific key

// Ensure config directory exists
if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// Read message from stdin (Chrome native messaging protocol)
function readMessage(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    stdin.setEncoding('binary');
    
    let buffer = Buffer.alloc(0);
    
    stdin.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk, 'binary')]);
      
      // First 4 bytes are message length
      if (buffer.length >= 4) {
        const messageLength = buffer.readUInt32LE(0);
        
        if (buffer.length >= 4 + messageLength) {
          const messageJson = buffer.slice(4, 4 + messageLength).toString('utf8');
          try {
            resolve(JSON.parse(messageJson));
          } catch (e) {
            reject(new Error('Invalid JSON message'));
          }
        }
      }
    });
    
    stdin.on('end', () => {
      reject(new Error('stdin ended'));
    });
  });
}

// Write message to stdout (Chrome native messaging protocol)
function writeMessage(message: unknown): void {
  const messageJson = JSON.stringify(message);
  const messageBuffer = Buffer.from(messageJson, 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(messageBuffer.length, 0);
  
  process.stdout.write(Buffer.concat([lengthBuffer, messageBuffer]));
}

// Encrypt auth data
function encrypt(data: string): string {
  const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// Decrypt auth data
function decrypt(data: string): string {
  const [ivHex, encrypted] = data.split(':');
  const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Handle incoming messages
interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

interface SyncMessage {
  type: 'SYNC_COOKIES';
  timestamp: number;
  domain: string;
  cookies: CookieData[];
}

async function handleMessage(message: SyncMessage): Promise<void> {
  if (message.type === 'SYNC_COOKIES') {
    const authData = {
      timestamp: message.timestamp,
      domain: message.domain,
      cookies: message.cookies,
      syncedAt: new Date().toISOString()
    };
    
    // Encrypt and save
    const encrypted = encrypt(JSON.stringify(authData));
    writeFileSync(AUTH_FILE, JSON.stringify({ encrypted }, null, 2));
    
    writeMessage({ type: 'ACK', success: true, cookieCount: message.cookies.length });
  }
}

// Main loop
async function main() {
  while (true) {
    try {
      const message = await readMessage() as SyncMessage;
      await handleMessage(message);
    } catch (error) {
      writeMessage({ type: 'ERROR', error: String(error) });
      break;
    }
  }
}

main();
```

---

### 3. CLI CDP Service Integration

#### src/models/config.ts (Updated)
```typescript
export interface CDPConfig {
  host: string;
  authFile?: string; // Path to cdp-auth.json, defaults to ~/.mr-rocket/cdp-auth.json
  tls?: CDPTLSConfig;
}

export interface CDPTLSConfig {
  rejectUnauthorized?: boolean;
  caFile?: string;
}
```

#### src/services/cdp.service.ts
```typescript
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createDecipheriv, scryptSync } from 'crypto';
import { logger } from '../core/logger.js';
import type { CDPConfig } from '../models/config.js';

interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

interface CDPAuthData {
  timestamp: number;
  domain: string;
  cookies: CDPCookie[];
  syncedAt: string;
}

interface BugMetadata {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  // Add more fields as needed
}

export class CDPService {
  private host: string;
  private authFile: string;
  private cookies: CDPCookie[] = [];
  private readonly encryptionKey = 'mr-rocket-cdp-auth-key';

  constructor(config: CDPConfig) {
    this.host = config.host;
    this.authFile = config.authFile || join(homedir(), '.mr-rocket', 'cdp-auth.json');
  }

  /**
   * Initialize the service by loading authentication
   */
  async init(): Promise<void> {
    await this.loadAuth();
  }

  /**
   * Load and decrypt authentication data from file
   */
  private async loadAuth(): Promise<void> {
    if (!existsSync(this.authFile)) {
      throw new Error(
        'CDP auth not found. Please install the MR-Rocket Chrome extension and log into CDP.'
      );
    }

    try {
      const fileContent = JSON.parse(readFileSync(this.authFile, 'utf-8'));
      const decrypted = this.decrypt(fileContent.encrypted);
      const authData: CDPAuthData = JSON.parse(decrypted);

      // Check if auth is stale (older than 24 hours)
      const authAge = Date.now() - authData.timestamp;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      if (authAge > maxAge) {
        logger.warn('CDP auth is stale, please refresh by visiting CDP in Chrome');
      }

      this.cookies = authData.cookies;
      logger.debug(`Loaded ${this.cookies.length} CDP cookies`);
    } catch (error) {
      throw new Error(`Failed to load CDP auth: ${error}`);
    }
  }

  /**
   * Decrypt auth data
   */
  private decrypt(data: string): string {
    const [ivHex, encrypted] = data.split(':');
    const key = scryptSync(this.encryptionKey, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Build cookie header string for HTTP requests
   */
  private getCookieHeader(): string {
    return this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Make authenticated request to CDP
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.host}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Cookie': this.getCookieHeader(),
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('CDP auth expired. Please refresh by visiting CDP in Chrome.');
      }
      throw new Error(`CDP request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * List bugs with optional filters
   */
  async listBugs(filter: {
    status?: string;
    priority?: string;
    assignee?: string;
    search?: string;
  } = {}): Promise<BugMetadata[]> {
    logger.debug('Listing CDP bugs', filter);

    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.priority) params.set('priority', filter.priority);
    if (filter.assignee) params.set('assignee', filter.assignee);
    if (filter.search) params.set('q', filter.search);

    const endpoint = `/api/bugs?${params.toString()}`;
    return this.request<BugMetadata[]>(endpoint);
  }

  /**
   * Get bug details by ID
   */
  async getBug(bugId: string): Promise<BugMetadata> {
    logger.debug('Getting CDP bug', { bugId });
    return this.request<BugMetadata>(`/api/bugs/${bugId}`);
  }

  /**
   * Check if authentication is valid
   */
  async checkAuth(): Promise<boolean> {
    try {
      await this.request('/api/user/me');
      return true;
    } catch {
      return false;
    }
  }
}
```

---

### 4. Installation & Setup Flow

#### One-Time Setup Script: `scripts/install-cdp-auth.sh`
```bash
#!/bin/bash

set -e

echo "🚀 MR-Rocket CDP Auth Setup"
echo "=============================="

# Configuration
MR_ROCKET_DIR="$HOME/.mr-rocket"
NATIVE_HOST_DIR="$MR_ROCKET_DIR/native-host"
EXTENSION_DIR="$MR_ROCKET_DIR/extension"

# Chrome native messaging host manifest locations
CHROME_NATIVE_HOST_DIR_MAC="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
CHROME_NATIVE_HOST_DIR_LINUX="$HOME/.config/google-chrome/NativeMessagingHosts"

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    CHROME_NATIVE_HOST_DIR="$CHROME_NATIVE_HOST_DIR_MAC"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CHROME_NATIVE_HOST_DIR="$CHROME_NATIVE_HOST_DIR_LINUX"
else
    echo "❌ Unsupported OS: $OSTYPE"
    exit 1
fi

# Create directories
echo "📁 Creating directories..."
mkdir -p "$NATIVE_HOST_DIR"
mkdir -p "$CHROME_NATIVE_HOST_DIR"

# Copy native host script
echo "📋 Installing native messaging host..."
cat > "$NATIVE_HOST_DIR/host.js" << 'EOF'
#!/usr/bin/env bun
// Native messaging host script content goes here
// (See host.js content above)
EOF

chmod +x "$NATIVE_HOST_DIR/host.js"

# Create native host manifest
echo "📋 Creating native host manifest..."
cat > "$CHROME_NATIVE_HOST_DIR/com.mrrocket.auth.json" << EOF
{
  "name": "com.mrrocket.auth",
  "description": "MR-Rocket Auth Native Messaging Host",
  "path": "$NATIVE_HOST_DIR/host.js",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://EXTENSION_ID_PLACEHOLDER/"
  ]
}
EOF

echo ""
echo "✅ Native messaging host installed!"
echo ""
echo "📌 Next Steps:"
echo "1. Load the Chrome extension from: extensions/mr-rocket-auth/"
echo "2. Note the extension ID and update: $CHROME_NATIVE_HOST_DIR/com.mrrocket.auth.json"
echo "3. Configure CDP domain in the extension popup"
echo "4. Log into CDP in Chrome - cookies will sync automatically"
echo ""
echo "🔧 To verify installation, run: bun run cli cdp status"
```

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         One-Time Setup                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Run: ./scripts/install-cdp-auth.sh                                       │
│ 2. Load extension in Chrome (chrome://extensions → Load unpacked)           │
│ 3. Note extension ID, update native host manifest                           │
│ 4. Click extension icon, configure CDP domain                               │
│ 5. Log into CDP in Chrome                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Daily Usage                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Extension runs silently in background                                     │
│ • Cookies auto-sync when you use CDP in browser                            │
│ • CLI uses synced cookies automatically                                     │
│                                                                             │
│ Commands:                                                                   │
│   bun run cli cdp status          # Check auth status                       │
│   bun run cli cdp bugs list       # List bugs                               │
│   bun run cli cdp bugs show 123   # Show bug details                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

1. **Cookie Encryption**: All cookies are encrypted using AES-256-CBC before storing to disk
2. **Native Messaging**: Uses Chrome's official native messaging protocol (more secure than HTTP)
3. **Extension Permissions**: Minimal permissions - only cookies for specific domain
4. **File Permissions**: Auth file should be readable only by user (`chmod 600`)
5. **No Password Storage**: Never stores username/password, only session cookies

---

## Future Enhancements

1. **Token Refresh Notification**: CLI warns when cookies are about to expire
2. **Multi-Domain Support**: Support multiple CDP instances
3. **Fallback Auth**: If cookies expire, prompt user to refresh in browser
4. **Health Check Endpoint**: Extension exposes status via local HTTP for CLI polling

---

## File Structure Summary

```
mr-rocket/
├── extensions/
│   └── mr-rocket-auth/           # Chrome extension
│       ├── manifest.json
│       ├── background.js
│       ├── popup/
│       │   ├── popup.html
│       │   ├── popup.css
│       │   └── popup.js
│       └── icons/
├── scripts/
│   └── install-cdp-auth.sh       # Setup script
├── src/
│   ├── services/
│   │   └── cdp.service.ts        # CDP service
│   └── models/
│       └── config.ts             # Updated with CDPConfig
└── docs/
    └── CDP_AUTH_SOLUTION.md      # This document
```
