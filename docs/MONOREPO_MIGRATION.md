# Monorepo Migration Plan

## Overview

Convert mr-rocket from a single project to a Bun workspaces monorepo with:
- **packages/cli** - Existing CLI/TUI application
- **packages/extension** - Chrome extension using WXT framework

---

## Target Structure

```
mr-rocket/
├── packages/
│   ├── cli/                        # Existing CLI/TUI app
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   ├── core/
│   │   │   ├── models/
│   │   │   ├── services/
│   │   │   ├── tui/
│   │   │   ├── types/
│   │   │   ├── utils/
│   │   │   ├── cli.ts
│   │   │   └── index.tsx
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── extension/                  # WXT Chrome extension
│       ├── src/
│       │   ├── entrypoints/
│       │   │   ├── background.ts   # Service worker
│       │   │   └── popup/          # Extension popup UI
│       │   │       ├── index.html
│       │   │       ├── main.tsx
│       │   │       └── App.tsx
│       │   ├── components/
│       │   ├── utils/
│       │   └── assets/
│       ├── public/
│       │   └── icons/
│       ├── wxt.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/shared/                # (Optional) Shared types/utils
│   ├── src/
│   │   └── types/
│   │       └── cdp-auth.ts
│   └── package.json
│
├── scripts/
│   └── install-native-host.sh      # Native messaging host installer
│
├── config/                         # Existing config
├── docs/                           # Documentation
├── package.json                    # Root workspace config
├── tsconfig.json                   # Root TS config (references)
├── bun.lock
├── AGENTS.md
└── README.md
```

---

## Migration Steps

### Step 1: Create Root Workspace Configuration

**package.json** (root):
```json
{
  "name": "mr-rocket",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev:cli": "bun run --filter @mr-rocket/cli dev",
    "dev:ext": "bun run --filter @mr-rocket/extension dev",
    "build:cli": "bun run --filter @mr-rocket/cli build",
    "build:ext": "bun run --filter @mr-rocket/extension build",
    "cli": "bun run --filter @mr-rocket/cli cli",
    "tui": "bun run --filter @mr-rocket/cli tui"
  }
}
```

**tsconfig.json** (root):
```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true
  },
  "references": [
    { "path": "./packages/cli" },
    { "path": "./packages/extension" },
    { "path": "./packages/shared" }
  ]
}
```

---

### Step 2: Move CLI/TUI to packages/cli

**packages/cli/package.json**:
```json
{
  "name": "@mr-rocket/cli",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.tsx",
    "cli": "bun run src/cli.ts",
    "tui": "bun run src/index.tsx",
    "build": "bun build --compile src/cli.ts --outfile dist/mr-rocket"
  },
  "dependencies": {
    "@gitbeaker/rest": "^40.0.3",
    "@opentui/core": "^0.1.69",
    "@opentui/react": "^0.1.69",
    "confluence.js": "^1.7.1",
    "react": "^19.2.3",
    "@mr-rocket/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

**packages/cli/tsconfig.json**:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" }
  ]
}
```

---

### Step 3: Create WXT Extension Package

**packages/extension/package.json**:
```json
{
  "name": "@mr-rocket/extension",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "@mr-rocket/shared": "workspace:*"
  },
  "devDependencies": {
    "wxt": "^0.19.0",
    "typescript": "^5"
  }
}
```

**packages/extension/wxt.config.ts**:
```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'MR-Rocket Auth Helper',
    description: 'Syncs CDP authentication for MR-Rocket CLI',
    version: '1.0.0',
    permissions: [
      'cookies',
      'nativeMessaging',
      'storage'
    ],
    host_permissions: [
      'https://*.your-cdp-domain.com/*'
    ]
  },
  runner: {
    startUrls: ['https://your-cdp-domain.com']
  }
});
```

**packages/extension/tsconfig.json**:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*", ".wxt/**/*"],
  "references": [
    { "path": "../shared" }
  ]
}
```

---

### Step 4: Create Shared Package (Optional but Recommended)

**packages/shared/package.json**:
```json
{
  "name": "@mr-rocket/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types/index.ts"
  }
}
```

**packages/shared/src/types/cdp-auth.ts**:
```typescript
export interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

export interface CDPAuthData {
  timestamp: number;
  domain: string;
  cookies: CDPCookie[];
  syncedAt: string;
}

export interface CDPSyncMessage {
  type: 'SYNC_COOKIES';
  timestamp: number;
  domain: string;
  cookies: CDPCookie[];
}

export interface CDPAckMessage {
  type: 'ACK';
  success: boolean;
  cookieCount: number;
}

export interface CDPErrorMessage {
  type: 'ERROR';
  error: string;
}

export type CDPMessage = CDPSyncMessage | CDPAckMessage | CDPErrorMessage;
```

**packages/shared/src/index.ts**:
```typescript
export * from './types/cdp-auth.js';
```

---

### Step 5: WXT Extension Entrypoints

**packages/extension/src/entrypoints/background.ts**:
```typescript
import { defineBackground } from 'wxt/sandbox';
import type { CDPCookie, CDPSyncMessage } from '@mr-rocket/shared';

const CONFIG_KEY = 'mrrocket_config';
const NATIVE_HOST = 'com.mrrocket.auth';

interface Config {
  cdpDomain: string;
  syncInterval: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: Config = {
  cdpDomain: 'your-cdp-domain.com',
  syncInterval: 60000,
  enabled: true
};

let config = DEFAULT_CONFIG;
let port: chrome.runtime.Port | null = null;

export default defineBackground(() => {
  // Initialize
  chrome.storage.local.get(CONFIG_KEY).then((stored) => {
    if (stored[CONFIG_KEY]) {
      config = { ...DEFAULT_CONFIG, ...stored[CONFIG_KEY] };
    }
    startCookieMonitor();
  });
});

function startCookieMonitor() {
  chrome.cookies.onChanged.addListener(handleCookieChange);
  syncCookies();
  setInterval(syncCookies, config.syncInterval);
}

function handleCookieChange(changeInfo: chrome.cookies.CookieChangeInfo) {
  if (!config.enabled) return;
  if (changeInfo.cookie.domain.includes(config.cdpDomain)) {
    syncCookies();
  }
}

async function syncCookies() {
  if (!config.enabled) return;

  try {
    const cookies = await chrome.cookies.getAll({ domain: config.cdpDomain });
    
    if (cookies.length === 0) {
      updateBadge('!', '#FFA500');
      return;
    }

    const message: CDPSyncMessage = {
      type: 'SYNC_COOKIES',
      timestamp: Date.now(),
      domain: config.cdpDomain,
      cookies: cookies.map((c): CDPCookie => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate
      }))
    };

    sendToNativeHost(message);
    updateBadge('✓', '#4CAF50');
  } catch (error) {
    console.error('Failed to sync cookies:', error);
    updateBadge('✗', '#F44336');
  }
}

function connectNativeHost(): chrome.runtime.Port | null {
  if (port) return port;

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    
    port.onMessage.addListener((message) => {
      if (message.type === 'ACK') {
        updateBadge('✓', '#4CAF50');
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      updateBadge('✗', '#F44336');
    });

    return port;
  } catch {
    return null;
  }
}

function sendToNativeHost(message: CDPSyncMessage) {
  const nativePort = connectNativeHost();
  if (nativePort) {
    nativePort.postMessage(message);
  } else {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message);
  }
}

function updateBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Handle popup messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATUS':
      sendResponse({
        enabled: config.enabled,
        domain: config.cdpDomain,
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

**packages/extension/src/entrypoints/popup/index.html**:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MR-Rocket Auth</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

**packages/extension/src/entrypoints/popup/main.tsx**:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);
```

**packages/extension/src/entrypoints/popup/App.tsx**:
```tsx
import { useState, useEffect } from 'react';

interface Status {
  enabled: boolean;
  domain: string;
  connected: boolean;
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [domain, setDomain] = useState('');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response: Status) => {
      setStatus(response);
      setDomain(response.domain);
    });
  }, []);

  const handleSync = () => {
    chrome.runtime.sendMessage({ type: 'FORCE_SYNC' });
  };

  const handleSave = () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: { cdpDomain: domain }
    }, () => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, setStatus);
    });
  };

  const handleToggle = () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: { enabled: !status?.enabled }
    }, () => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, setStatus);
    });
  };

  if (!status) return <div className="loading">Loading...</div>;

  return (
    <div className="container">
      <h1>🚀 MR-Rocket Auth</h1>
      
      <div className="status-section">
        <div className="status-row">
          <span>Status:</span>
          <span className={`badge ${status.connected ? 'success' : 'error'}`}>
            {status.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="status-row">
          <span>Enabled:</span>
          <span className={`badge ${status.enabled ? 'success' : 'warning'}`}>
            {status.enabled ? 'Yes' : 'No'}
          </span>
        </div>
      </div>

      <div className="config-section">
        <label>
          CDP Domain:
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="your-cdp-domain.com"
          />
        </label>
      </div>

      <div className="actions">
        <button onClick={handleSync} className="btn primary">
          Sync Now
        </button>
        <button onClick={handleToggle} className="btn">
          {status.enabled ? 'Disable' : 'Enable'}
        </button>
        <button onClick={handleSave} className="btn">
          Save
        </button>
      </div>
    </div>
  );
}
```

**packages/extension/src/entrypoints/popup/style.css**:
```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  width: 300px;
  padding: 16px;
  background: #1a1a2e;
  color: #eee;
}

.container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  font-size: 18px;
  text-align: center;
  margin-bottom: 8px;
}

.status-section {
  background: #16213e;
  padding: 12px;
  border-radius: 8px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.badge.success {
  background: #4caf50;
  color: white;
}

.badge.error {
  background: #f44336;
  color: white;
}

.badge.warning {
  background: #ff9800;
  color: white;
}

.config-section label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}

.config-section input {
  padding: 8px;
  border: 1px solid #333;
  border-radius: 4px;
  background: #0f0f23;
  color: #eee;
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  background: #333;
  color: #eee;
}

.btn:hover {
  background: #444;
}

.btn.primary {
  background: #4361ee;
  color: white;
}

.btn.primary:hover {
  background: #3a56d4;
}

.loading {
  text-align: center;
  padding: 20px;
}
```

---

## Execution Commands

```bash
# Step 1: Create directory structure
mkdir -p packages/cli packages/extension packages/shared

# Step 2: Move existing source to packages/cli
mv src packages/cli/
mv config packages/cli/  # if config is CLI-specific

# Step 3: Initialize WXT extension
cd packages/extension
bunx wxt@latest init --template vanilla
# Choose: bun as package manager

# Step 4: Install all dependencies from root
cd ../..
bun install

# Step 5: Verify CLI still works
bun run cli --help

# Step 6: Start extension dev
bun run dev:ext
```

---

## Benefits of This Structure

1. **Separation of Concerns**: CLI and extension are independent packages
2. **Shared Types**: Common types (CDPAuthData, etc.) live in `@mr-rocket/shared`
3. **Independent Development**: Run `bun run dev:ext` without affecting CLI
4. **Bun Workspaces**: Native workspace support, fast installs
5. **WXT Framework**: Modern extension dev with HMR, TypeScript, easy manifest management

---

## Native Messaging Host (Remains in scripts/)

The native messaging host script stays at the project level in `scripts/` since it:
- Needs to be installed to a system location
- Is not part of the extension bundle
- Is shared between extension and CLI

See [CDP_AUTH_SOLUTION.md](./CDP_AUTH_SOLUTION.md) for native host implementation details.
