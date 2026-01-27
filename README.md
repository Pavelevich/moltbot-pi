# Moltbot Lite for Raspberry Pi

<p align="center">
  <img src="assets/Raspclaut.png" alt="Moltbot Lite" width="200"/>
</p>

<p align="center">
  <strong>A lightweight AI-powered Telegram bot optimized for Raspberry Pi Zero 2W</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#hardware-requirements">Hardware</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#lcd-display">LCD Display</a>
</p>

---

## Overview

Moltbot Lite is a stripped-down, memory-efficient version of [Moltbot](https://github.com/moltbot/moltbot) designed to run on resource-constrained devices like the **Raspberry Pi Zero 2W** with only **512MB RAM**.

This project enables you to run a fully functional AI-powered Telegram bot on a tiny, low-power device using the **DeepSeek API** (OpenAI-compatible) for affordable AI responses.

### Performance Metrics

| Metric | Moltbot Lite | Original Moltbot |
|--------|--------------|------------------|
| RAM (idle) | ~85 MB | ~400 MB |
| RAM (active) | ~120 MB | ~600 MB |
| node_modules | 34 MB | ~700 MB |
| Dependencies | 101 packages | 1000+ packages |
| Startup time | ~3 seconds | ~10 seconds |

---

## Features

### Included
- Telegram bot with DeepSeek AI integration
- Chat with AI (questions, writing, coding, translation)
- System status monitoring via `/status` command
- LCD display support (Waveshare 1.44" HAT)
- Lazy-loading architecture for minimal memory usage
- Feature flags system for customization

### Disabled in Lite Mode (saves memory)
- Browser automation (Playwright)
- Image processing (Sharp)
- WhatsApp Web (Baileys)
- PDF parsing
- Local LLM embeddings

---

## Hardware Requirements

### Minimum Setup
| Component | Model | Notes |
|-----------|-------|-------|
| **Board** | Raspberry Pi Zero 2W | 512MB RAM, ARM64 |
| **Storage** | MicroSD 8GB+ | Class 10 recommended |
| **Power** | 5V 2.5A adapter | Stable power required |
| **Network** | WiFi or USB Ethernet | Built-in WiFi on Pi Zero 2W |

### Optional: LCD Display
| Component | Model | Specifications |
|-----------|-------|----------------|
| **Display** | Waveshare 1.44" LCD HAT | ST7735S, 128x128 pixels, SPI |

#### LCD HAT Pinout (ST7735S)
```
┌─────────────────────────────────┐
│  Waveshare 1.44" LCD HAT Pins   │
├─────────────────────────────────┤
│  RST  → GPIO 27                 │
│  DC   → GPIO 25                 │
│  BL   → GPIO 24 (Backlight)     │
│  CS   → GPIO 8  (SPI CE0)       │
│  CLK  → GPIO 11 (SPI SCLK)      │
│  DIN  → GPIO 10 (SPI MOSI)      │
└─────────────────────────────────┘
```

#### Buttons & Joystick (if available on HAT)
```
KEY1    → GPIO 21
KEY2    → GPIO 20
KEY3    → GPIO 16
JOY UP  → GPIO 6
JOY DOWN→ GPIO 19
JOY LEFT→ GPIO 5
JOY RIGHT→ GPIO 26
JOY PRESS→ GPIO 13
```

---

## Installation

### Prerequisites

1. **Raspberry Pi OS** (64-bit Lite recommended)
2. **Node.js 22+**
3. **API Keys:**
   - Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
   - DeepSeek API Key (from [platform.deepseek.com](https://platform.deepseek.com))

### Quick Install

```bash
# SSH into your Raspberry Pi
ssh pi@your-pi-ip

# Clone the repository
git clone https://github.com/Pavelevich/moltbot-lite-pi.git
cd moltbot-lite-pi

# Install Node.js 22 (if not installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install dependencies (lite only, ~34MB)
npm install --omit=optional --ignore-scripts

# Copy environment template
cp .env.example .env

# Edit with your API keys
nano .env
```

### Manual Installation

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Verify installation
node --version  # Should be v22.x.x

# 4. Clone and setup
git clone https://github.com/Pavelevich/moltbot-lite-pi.git
cd moltbot-lite-pi
npm install --omit=optional --ignore-scripts

# 5. Configure environment
cp .env.example .env
nano .env  # Add your API keys
```

---

## Configuration

### Environment Variables

Create a `.env` file with your API keys:

```env
# Telegram Bot Token (from @BotFather)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# DeepSeek API Key (from platform.deepseek.com)
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# Profile (leave as raspberry-pi for Pi Zero 2W)
MOLTBOT_PROFILE=raspberry-pi
```

### Getting API Keys

#### Telegram Bot Token
1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Choose a name (e.g., "My Pi Bot")
4. Choose a username (e.g., "my_pi_bot")
5. Copy the token provided

#### DeepSeek API Key
1. Go to [platform.deepseek.com](https://platform.deepseek.com)
2. Create an account
3. Navigate to API Keys
4. Create a new API key
5. Copy the key (starts with `sk-`)

---

## Usage

### Starting the Bot

```bash
cd moltbot-lite-pi

# Option 1: Direct run
node --experimental-strip-types src/bot.ts

# Option 2: With environment file
source .env && node --experimental-strip-types src/bot.ts

# Option 3: Background process
nohup node --experimental-strip-types src/bot.ts > bot.log 2>&1 &
```

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and instructions |
| `/status` | Show bot status, RAM usage, uptime |
| Any text | Chat with DeepSeek AI |

### Example Interactions

```
You: Hello, what can you do?
Bot: I'm Moltbot, running on a Raspberry Pi! I can help you with...

You: /status
Bot: 📊 Status of Moltbot Lite
     🖥️ Raspberry Pi Zero 2W
     ⏱️ Uptime: 5m 32s
     💾 RAM: 85 MB
     🤖 AI: DeepSeek ✓

You: Write a haiku about robots
Bot: Silicon dreams wake,
     Circuits hum with quiet thought,
     Metal hearts beat on.
```

---

## LCD Display

### Setup

```bash
# Install Python dependencies
sudo apt-get install -y python3-pip python3-pil python3-numpy
pip3 install st7735 spidev RPi.GPIO gpiodevice --break-system-packages

# Enable SPI
sudo raspi-config
# Navigate to: Interface Options → SPI → Enable
```

### Display an Image

```bash
# Display your custom image
python3 scripts/display_icon.py assets/Raspclaut.png

# Display text
python3 scripts/display_icon.py "HELLO"

# Default (shows MOLTBOT)
python3 scripts/display_icon.py
```

### Customize Display Script

Edit `scripts/display_icon.py` to customize colors, fonts, or add animations.

---

## Running as a Service

### Create systemd Service

```bash
sudo nano /etc/systemd/system/moltbot.service
```

Add the following:

```ini
[Unit]
Description=Moltbot Lite Telegram Bot
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/moltbot-lite-pi
EnvironmentFile=/home/pi/moltbot-lite-pi/.env
ExecStart=/usr/bin/node --experimental-strip-types src/bot.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable moltbot
sudo systemctl start moltbot

# Check status
sudo systemctl status moltbot

# View logs
journalctl -u moltbot -f
```

---

## Project Structure

```
moltbot-lite-pi/
├── src/
│   ├── bot.ts              # Main Telegram bot with DeepSeek
│   ├── infra/
│   │   └── features.ts     # Feature flags system
│   └── compat/
│       ├── index.ts        # Compatibility layer exports
│       ├── lazy-playwright.ts
│       ├── lazy-sharp.ts
│       ├── lazy-baileys.ts
│       ├── lazy-pdfjs.ts
│       └── lazy-llama.ts
├── scripts/
│   ├── display_icon.py     # LCD display script
│   ├── install-raspberry-pi.sh
│   └── build-raspberry-pi.sh
├── config/
│   └── raspberry-pi.yml    # Default Pi configuration
├── assets/
│   └── Raspclaut.png       # Project logo
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Feature Flags

The feature flags system allows you to enable/disable features based on your hardware capabilities.

### Available Profiles

| Profile | RAM Target | Use Case |
|---------|------------|----------|
| `default` | 2GB+ | Full-featured (Mac/Linux/Server) |
| `raspberry-pi` | 512MB | Raspberry Pi Zero 2W |
| `embedded` | 256MB | Ultra-minimal IoT devices |

### Customizing Features

Edit `src/infra/features.ts` or set environment variables:

```bash
# Disable browser features
export MOLTBOT_DISABLE_BROWSER=1

# Enable only specific channels
export MOLTBOT_CHANNELS=telegram,webchat
```

---

## Troubleshooting

### Bot won't start
```bash
# Check Node.js version
node --version  # Must be 22+

# Check if port is in use
lsof -i :18789

# Check logs
tail -f bot.log
```

### Display not working
```bash
# Check SPI is enabled
ls /dev/spi*  # Should show spidev0.0

# Test with simple script
python3 -c "import st7735; print('OK')"
```

### Out of memory
```bash
# Check memory usage
free -m

# Kill other processes
sudo systemctl stop bluetooth
sudo systemctl stop avahi-daemon
```

### Network issues
```bash
# Check WiFi
iwconfig wlan0

# Restart networking
sudo systemctl restart networking
```

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Moltbot](https://github.com/moltbot/moltbot) - Original project
- [DeepSeek](https://deepseek.com) - Affordable AI API
- [Grammy](https://grammy.dev) - Telegram Bot Framework
- [Waveshare](https://waveshare.com) - LCD HAT hardware

---

## Author

**Pavelevich**

- GitHub: [@Pavelevich](https://github.com/Pavelevich)

---

<p align="center">
  Made with ❤️ for the Raspberry Pi community
</p>
