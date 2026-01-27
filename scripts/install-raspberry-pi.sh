#!/bin/bash
#
# Moltbot Lite - Raspberry Pi Installation Script
#
# Installs Moltbot Lite on a Raspberry Pi Zero 2W or similar device.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/moltbot/moltbot/main/scripts/install-raspberry-pi.sh | bash
#
# Or download and run:
#   wget https://raw.githubusercontent.com/moltbot/moltbot/main/scripts/install-raspberry-pi.sh
#   chmod +x install-raspberry-pi.sh
#   ./install-raspberry-pi.sh
#

set -e

MOLTBOT_VERSION="${MOLTBOT_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/moltbot}"
RELEASE_URL="https://github.com/moltbot/moltbot/releases/download"

echo "=== Moltbot Lite Installation for Raspberry Pi ==="
echo ""

# Check architecture
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ] && [ "$ARCH" != "x86_64" ]; then
  echo "Warning: Unsupported architecture: $ARCH"
  echo "Moltbot Lite is optimized for ARM64 and x86_64"
fi

# Check memory
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
echo "Detected memory: ${TOTAL_MEM_MB}MB"

if [ "$TOTAL_MEM_MB" -lt 400 ]; then
  echo "Error: At least 400MB RAM required"
  exit 1
fi

if [ "$TOTAL_MEM_MB" -lt 600 ]; then
  echo "Note: Running on limited memory. Using raspberry-pi profile."
fi

# 1. Check/Install Node.js 22
echo ""
echo "[1/6] Checking Node.js..."

if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -ge 22 ]; then
    echo "Node.js $(node --version) found ✓"
  else
    echo "Node.js $NODE_VERSION found, but version 22+ required"
    INSTALL_NODE=1
  fi
else
  echo "Node.js not found"
  INSTALL_NODE=1
fi

if [ "$INSTALL_NODE" = "1" ]; then
  echo "Installing Node.js 22..."

  # Try NodeSource first (works on Debian/Ubuntu)
  if [ -f /etc/debian_version ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  # Try fnm as fallback
  elif command -v curl &> /dev/null; then
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "$(fnm env)"
    fnm install 22
    fnm use 22
  else
    echo "Error: Could not install Node.js. Please install Node.js 22+ manually."
    exit 1
  fi

  echo "Node.js $(node --version) installed ✓"
fi

# 2. Create installation directory
echo ""
echo "[2/6] Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 3. Download Moltbot Lite
echo ""
echo "[3/6] Downloading Moltbot Lite..."

if [ "$MOLTBOT_VERSION" = "latest" ]; then
  DOWNLOAD_URL="$RELEASE_URL/latest/download/moltbot-lite-arm64.tar.gz"
else
  DOWNLOAD_URL="$RELEASE_URL/$MOLTBOT_VERSION/moltbot-lite-arm64.tar.gz"
fi

# Try downloading from releases, fall back to building from source
if curl -fsSL "$DOWNLOAD_URL" -o moltbot-lite.tar.gz 2>/dev/null; then
  echo "Downloaded from releases ✓"
  tar -xzf moltbot-lite.tar.gz
  mv dist-lite/* . 2>/dev/null || true
  rm -rf dist-lite moltbot-lite.tar.gz
else
  echo "Release not found, installing from npm..."
  npm init -y
  npm install moltbot --omit=optional --ignore-scripts || {
    echo "npm install failed. Trying git clone..."
    git clone --depth 1 https://github.com/moltbot/moltbot.git moltbot-src
    cd moltbot-src
    npm install --omit=optional --ignore-scripts
    npm run build || true
    cd ..
  }
fi

# 4. Install dependencies
echo ""
echo "[4/6] Installing dependencies..."
npm install --omit=optional --ignore-scripts 2>/dev/null || true

# 5. Create configuration
echo ""
echo "[5/6] Creating configuration..."
mkdir -p ~/.moltbot

if [ ! -f ~/.moltbot/config.yml ]; then
  cat > ~/.moltbot/config.yml << 'CONFIG'
# Moltbot Lite Configuration for Raspberry Pi
profile: raspberry-pi

gateway:
  mode: local
  port: 18789
  bind: 0.0.0.0

channels:
  telegram:
    enabled: true
    # Run: moltbot config set telegram.botToken YOUR_TOKEN

agents:
  - name: main
    provider: anthropic
    model: claude-sonnet-4-20250514
    vision: api

tools:
  bash:
    enabled: true
  files:
    enabled: true

memory:
  provider: openai
CONFIG
  echo "Configuration created at ~/.moltbot/config.yml ✓"
else
  echo "Configuration already exists ✓"
fi

# 6. Create systemd service (optional)
echo ""
echo "[6/6] Setting up systemd service..."

SERVICE_FILE="/etc/systemd/system/moltbot.service"
if [ -w /etc/systemd/system ] || [ "$(id -u)" = "0" ]; then
  sudo tee "$SERVICE_FILE" > /dev/null << SERVICE
[Unit]
Description=Moltbot Lite
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
Environment=MOLTBOT_PROFILE=raspberry-pi
Environment=NODE_ENV=production
ExecStart=$(which node) entry.js gateway run --port 18789
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

  sudo systemctl daemon-reload
  echo "Systemd service created ✓"
  echo ""
  echo "To enable auto-start: sudo systemctl enable moltbot"
  echo "To start now: sudo systemctl start moltbot"
else
  echo "Skipping systemd setup (no root access)"
fi

# Summary
echo ""
echo "=== Installation Complete ==="
echo ""
echo "Installation directory: $INSTALL_DIR"
echo "Configuration: ~/.moltbot/config.yml"
echo ""
echo "Next steps:"
echo "  1. Set your Anthropic API key:"
echo "     export ANTHROPIC_API_KEY=your_key_here"
echo ""
echo "  2. Set your Telegram bot token:"
echo "     export TELEGRAM_BOT_TOKEN=your_token_here"
echo "     # Or: moltbot config set telegram.botToken YOUR_TOKEN"
echo ""
echo "  3. Start Moltbot:"
echo "     cd $INSTALL_DIR"
echo "     MOLTBOT_PROFILE=raspberry-pi node entry.js gateway run"
echo ""
echo "  4. Or use systemd:"
echo "     sudo systemctl start moltbot"
echo "     sudo systemctl status moltbot"
echo "     journalctl -u moltbot -f"
echo ""
echo "Memory usage: ~100-150MB idle, ~150-250MB active"
echo ""
