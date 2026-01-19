#!/bin/bash

set -e

echo "🚀 MR-Rocket CDP Auth Setup"
echo "=============================="

# Configuration
MR_ROCKET_DIR="$HOME/.mr-rocket"
NATIVE_HOST_DIR="$MR_ROCKET_DIR/native-host"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Chrome native messaging host manifest locations
CHROME_NATIVE_HOST_DIR_MAC="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
CHROME_NATIVE_HOST_DIR_LINUX="$HOME/.config/google-chrome/NativeMessagingHosts"
CHROMIUM_NATIVE_HOST_DIR_LINUX="$HOME/.config/chromium/NativeMessagingHosts"

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    CHROME_NATIVE_HOST_DIR="$CHROME_NATIVE_HOST_DIR_MAC"
    echo "📍 Detected macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Prefer Chrome over Chromium
    if [[ -d "$HOME/.config/google-chrome" ]]; then
        CHROME_NATIVE_HOST_DIR="$CHROME_NATIVE_HOST_DIR_LINUX"
    else
        CHROME_NATIVE_HOST_DIR="$CHROMIUM_NATIVE_HOST_DIR_LINUX"
    fi
    echo "📍 Detected Linux"
else
    echo "❌ Unsupported OS: $OSTYPE"
    exit 1
fi

# Check for pre-compiled native host binary
NATIVE_HOST_BINARY="$PROJECT_ROOT/dist/native-host"

if [[ ! -f "$NATIVE_HOST_BINARY" ]]; then
    echo "❌ Native host binary not found at: $NATIVE_HOST_BINARY"
    echo "   Please build it first with: bun run build:native-host"
    exit 1
fi

echo "📍 Found native host binary at: $NATIVE_HOST_BINARY"

# Create directories
echo ""
echo "📁 Creating directories..."
mkdir -p "$NATIVE_HOST_DIR"
mkdir -p "$CHROME_NATIVE_HOST_DIR"

# Copy native host binary
echo "📋 Installing native messaging host binary..."
cp "$NATIVE_HOST_BINARY" "$NATIVE_HOST_DIR/native-host"
chmod +x "$NATIVE_HOST_DIR/native-host"

# Create native host manifest (placeholder for extension ID)
EXTENSION_ID="${1:-EXTENSION_ID_PLACEHOLDER}"

echo "📋 Creating native host manifest..."
cat > "$CHROME_NATIVE_HOST_DIR/com.mrrocket.auth.json" << EOF
{
  "name": "com.mrrocket.auth",
  "description": "MR-Rocket Auth Native Messaging Host",
  "path": "$NATIVE_HOST_DIR/native-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo ""
echo "✅ Native messaging host installed!"
echo ""
echo "📌 Next Steps:"
echo ""
echo "1. Build the Chrome extension (if not already built):"
echo "   bun run build:ext"
echo ""
echo "2. Load the extension in Chrome:"
echo "   - Open chrome://extensions"
echo "   - Enable 'Developer mode'"
echo "   - Click 'Load unpacked'"
echo "   - Select: $PROJECT_ROOT/packages/extension/.output/chrome-mv3"
echo ""
echo "3. Copy the Extension ID from Chrome and run:"
echo "   $0 <extension-id>"
echo ""
echo "4. Configure CDP domain in ~/.mr-rocket/config.json:"
echo '   "cdp": {'
echo '     "host": "https://your-cdp-domain.com"'
echo '   }'
echo ""
echo "5. Click the extension icon in Chrome and configure the CDP domain"
echo ""
echo "6. Log into CDP in your browser - cookies will sync automatically!"
echo ""
echo "🔧 To verify installation, run: bun run cli cdp status"
