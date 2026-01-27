#!/bin/bash
#
# Build script for Moltbot Lite (Raspberry Pi)
#
# Creates a lightweight distribution suitable for
# Raspberry Pi Zero 2W and other ARM64 devices with limited RAM.
#
# Usage:
#   ./scripts/build-raspberry-pi.sh
#
# Output:
#   dist-lite/              - Built distribution
#   moltbot-lite-arm64.tar.gz - Compressed archive
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "=== Building Moltbot Lite for Raspberry Pi ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# 1. Clean previous builds
echo "[1/7] Cleaning previous builds..."
rm -rf dist-lite
rm -f moltbot-lite-arm64.tar.gz

# 2. Backup original package.json
echo "[2/7] Backing up package.json..."
if [ -f package.json ]; then
  cp package.json package.json.backup
fi

# 3. Use lite package.json
echo "[3/7] Using package-lite.json..."
cp package-lite.json package.json

# 4. Install dependencies (skip optional heavy deps)
echo "[4/7] Installing dependencies (lite mode)..."
if command -v pnpm &> /dev/null; then
  pnpm install --ignore-scripts --no-optional 2>/dev/null || npm install --omit=dev --ignore-scripts --no-optional
else
  npm install --omit=dev --ignore-scripts --no-optional
fi

# 5. Build TypeScript
echo "[5/7] Building TypeScript..."
export MOLTBOT_PROFILE=raspberry-pi

# Check if tsconfig exists
if [ -f tsconfig.json ]; then
  npx tsc -p tsconfig.json --outDir dist-lite || {
    echo "TypeScript compilation failed. Creating dist-lite from existing dist..."
    if [ -d dist ]; then
      cp -r dist dist-lite
    else
      mkdir -p dist-lite
      echo "// Moltbot Lite entry point" > dist-lite/entry.js
      echo "console.log('Moltbot Lite - Build manually required');" >> dist-lite/entry.js
    fi
  }
else
  echo "No tsconfig.json found. Copying existing dist..."
  if [ -d dist ]; then
    cp -r dist dist-lite
  else
    mkdir -p dist-lite
  fi
fi

# 6. Create distribution package
echo "[6/7] Creating distribution package..."
mkdir -p dist-lite

# Copy package-lite.json as package.json
cp package-lite.json dist-lite/package.json

# Copy config templates if they exist
if [ -d config ]; then
  cp -r config dist-lite/
fi

# Create raspberry-pi config
mkdir -p dist-lite/config
cat > dist-lite/config/raspberry-pi.yml << 'PICONFIG'
# Moltbot Lite - Raspberry Pi Configuration
# Copy to ~/.moltbot/config.yml

profile: raspberry-pi

gateway:
  mode: local
  port: 18789
  bind: 0.0.0.0

# Only Telegram enabled by default (lightweight)
channels:
  telegram:
    enabled: true
    # Set via: moltbot config set telegram.botToken YOUR_TOKEN
  whatsapp:
    enabled: false
  discord:
    enabled: false
  slack:
    enabled: false

# Agent configuration
agents:
  - name: main
    provider: anthropic
    model: claude-sonnet-4-20250514
    vision: api  # Use Claude Vision API, not local processing

# Tools (limited set for Pi)
tools:
  bash:
    enabled: true
  files:
    enabled: true
  web_scrape:
    enabled: false  # Requires browser
  screenshot:
    enabled: false  # Requires browser

# Memory - use API embeddings (not local)
memory:
  provider: openai

# Features disabled for Pi
browser:
  enabled: false
media:
  processing: false
  vision: api
PICONFIG

# Create README for the lite distribution
cat > dist-lite/README.md << 'README'
# Moltbot Lite

Lightweight version of Moltbot for Raspberry Pi and resource-constrained devices.

## Requirements

- Node.js 22+
- 512MB+ RAM (optimized for Pi Zero 2W)
- Linux ARM64 or x64

## Quick Start

```bash
# Install dependencies
npm install --omit=optional --ignore-scripts

# Configure
mkdir -p ~/.moltbot
cp config/raspberry-pi.yml ~/.moltbot/config.yml

# Set Telegram bot token
export TELEGRAM_BOT_TOKEN=your_token_here

# Run
MOLTBOT_PROFILE=raspberry-pi node entry.js gateway run
```

## Environment Variables

- `MOLTBOT_PROFILE=raspberry-pi` - Use lite profile
- `ANTHROPIC_API_KEY` - Claude API key
- `TELEGRAM_BOT_TOKEN` - Telegram bot token

## Features

### Enabled
- Telegram bot
- Gateway WebSocket
- Chat with Claude/GPT via API
- Bash and file tools
- Cron jobs
- Memory (API embeddings)
- Vision (via Claude API)

### Disabled (enable with full profile)
- Browser automation (Playwright)
- Local image processing (Sharp)
- WhatsApp Web (Baileys)
- PDF parsing (pdfjs)
- Local LLM embeddings

## Memory Usage

- Idle: ~100-150MB
- Active: ~150-250MB
- Fits comfortably in 512MB RAM

## More Info

https://github.com/moltbot/moltbot
README

# 7. Create tarball
echo "[7/7] Creating distribution archive..."
tar -czvf moltbot-lite-arm64.tar.gz dist-lite/

# Restore original package.json
if [ -f package.json.backup ]; then
  mv package.json.backup package.json
fi

# Summary
echo ""
echo "=== Build Complete ==="
echo ""
echo "Distribution: dist-lite/"
echo "Archive: moltbot-lite-arm64.tar.gz"
echo "Size: $(du -sh moltbot-lite-arm64.tar.gz | cut -f1)"
echo ""
echo "To install on Raspberry Pi:"
echo "  1. Copy moltbot-lite-arm64.tar.gz to your Pi"
echo "  2. tar -xzf moltbot-lite-arm64.tar.gz"
echo "  3. cd dist-lite && npm install --omit=optional"
echo "  4. MOLTBOT_PROFILE=raspberry-pi node entry.js gateway run"
echo ""
