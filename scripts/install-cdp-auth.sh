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

# Check for bun
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is required but not installed."
    echo "   Install it from: https://bun.sh"
    exit 1
fi

BUN_PATH=$(which bun)
echo "📍 Found bun at: $BUN_PATH"

# Create directories
echo ""
echo "📁 Creating directories..."
mkdir -p "$NATIVE_HOST_DIR"
mkdir -p "$CHROME_NATIVE_HOST_DIR"

# Copy native host script
echo "📋 Installing native messaging host..."
cp "$SCRIPT_DIR/native-host.ts" "$NATIVE_HOST_DIR/host.ts"

# Create wrapper script
cat > "$NATIVE_HOST_DIR/host.sh" << EOF
#!/bin/bash
exec "$BUN_PATH" run "$NATIVE_HOST_DIR/host.ts" "\$@"
EOF

chmod +x "$NATIVE_HOST_DIR/host.sh"

# Create native host manifest (placeholder for extension ID)
EXTENSION_ID="${1:-EXTENSION_ID_PLACEHOLDER}"

echo "📋 Creating native host manifest..."
cat > "$CHROME_NATIVE_HOST_DIR/com.mrrocket.auth.json" << EOF
{
  "name": "com.mrrocket.auth",
  "description": "MR-Rocket Auth Native Messaging Host",
  "path": "$NATIVE_HOST_DIR/host.sh",
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
echo "1. Build the Chrome extension:"
echo "   cd $PROJECT_ROOT"
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
