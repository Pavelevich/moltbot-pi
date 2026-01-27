/**
 * Feature Flags System for Moltbot
 *
 * Allows running Moltbot in different profiles:
 * - default: Full features (Mac/Linux/Server with 2GB+ RAM)
 * - raspberry-pi: Minimal features (Pi Zero 2W with 512MB RAM)
 * - lite: Same as raspberry-pi
 * - embedded: Ultra-minimal for IoT devices
 *
 * Usage:
 *   MOLTBOT_PROFILE=raspberry-pi moltbot gateway
 *
 * Or in config.yml:
 *   profile: raspberry-pi
 */

export interface ChannelFeatures {
  whatsapp: boolean;
  telegram: boolean;
  discord: boolean;
  slack: boolean;
  signal: boolean;
  imessage: boolean;
  line: boolean;
  msteams: boolean;
  matrix: boolean;
  googlechat: boolean;
  webchat: boolean;
}

export interface ToolFeatures {
  bash: boolean;
  files: boolean;
  webScrape: boolean;
  screenshot: boolean;
  browser: boolean;
  imageEdit: boolean;
}

export interface FeatureFlags {
  // Heavy dependencies
  browser: boolean; // Playwright automation (~400MB)
  imageProcessing: boolean; // Sharp library (~150MB)
  pdfParsing: boolean; // pdfjs-dist (~30MB)
  localLLM: boolean; // node-llama-cpp (~200MB)
  canvas: boolean; // @napi-rs/canvas (~50MB)

  // UI features
  tui: boolean; // Terminal UI
  controlUI: boolean; // Web control UI

  // Media features
  mediaUnderstanding: boolean; // Vision/audio AI
  tts: boolean; // Text-to-speech
  voiceWake: boolean; // Voice wake detection

  // Channels
  channels: ChannelFeatures;

  // Tools
  tools: ToolFeatures;

  // Memory/Embeddings
  localEmbeddings: boolean; // Use local LLM for embeddings
  vectorDB: boolean; // LanceDB vector storage

  // Misc
  bonjour: boolean; // mDNS discovery
  tailscale: boolean; // Tailscale integration
  cron: boolean; // Scheduled tasks
}

/**
 * Default profile - Full features for Mac/Linux/Server
 */
export const defaultFeatures: FeatureFlags = {
  browser: true,
  imageProcessing: true,
  pdfParsing: true,
  localLLM: false, // Optional by default
  canvas: false, // Optional by default

  tui: true,
  controlUI: true,

  mediaUnderstanding: true,
  tts: true,
  voiceWake: true,

  channels: {
    whatsapp: true,
    telegram: true,
    discord: true,
    slack: true,
    signal: true,
    imessage: true,
    line: true,
    msteams: true,
    matrix: true,
    googlechat: true,
    webchat: true,
  },

  tools: {
    bash: true,
    files: true,
    webScrape: true,
    screenshot: true,
    browser: true,
    imageEdit: true,
  },

  localEmbeddings: false,
  vectorDB: true,

  bonjour: true,
  tailscale: true,
  cron: true,
};

/**
 * Raspberry Pi profile - Minimal features for 512MB RAM
 * Disables heavy native dependencies, keeps core functionality
 */
export const raspberryPiFeatures: FeatureFlags = {
  // Disable heavy native deps
  browser: false, // No Playwright
  imageProcessing: false, // No Sharp - use Claude Vision API
  pdfParsing: false, // No pdfjs
  localLLM: false, // No local LLM
  canvas: false, // No canvas

  // Disable UI (headless server)
  tui: false,
  controlUI: false,

  // Media via API only
  mediaUnderstanding: true, // Use Claude Vision API
  tts: false, // Disable TTS
  voiceWake: false, // Disable voice wake

  // Only lightweight channels
  channels: {
    whatsapp: false, // Baileys is heavy
    telegram: true, // Grammy is lightweight (~2MB)
    discord: false,
    slack: false,
    signal: false,
    imessage: false,
    line: false,
    msteams: false,
    matrix: false,
    googlechat: false,
    webchat: true, // Keep for local control
  },

  // Limited tools
  tools: {
    bash: true, // Keep for system control
    files: true, // Keep for file ops
    webScrape: false, // Requires browser
    screenshot: false, // Requires browser
    browser: false, // Requires Playwright
    imageEdit: false, // Requires Sharp
  },

  // Use API embeddings
  localEmbeddings: false,
  vectorDB: false, // Disable LanceDB

  // Disable discovery features
  bonjour: false,
  tailscale: false, // Can enable if needed
  cron: true, // Keep cron
};

/**
 * Embedded profile - Ultra-minimal for IoT/microcontrollers
 */
export const embeddedFeatures: FeatureFlags = {
  browser: false,
  imageProcessing: false,
  pdfParsing: false,
  localLLM: false,
  canvas: false,

  tui: false,
  controlUI: false,

  mediaUnderstanding: false,
  tts: false,
  voiceWake: false,

  channels: {
    whatsapp: false,
    telegram: true, // Single channel
    discord: false,
    slack: false,
    signal: false,
    imessage: false,
    line: false,
    msteams: false,
    matrix: false,
    googlechat: false,
    webchat: false,
  },

  tools: {
    bash: true,
    files: false,
    webScrape: false,
    screenshot: false,
    browser: false,
    imageEdit: false,
  },

  localEmbeddings: false,
  vectorDB: false,

  bonjour: false,
  tailscale: false,
  cron: false,
};

/**
 * Profile registry
 */
const profiles: Record<string, FeatureFlags> = {
  default: defaultFeatures,
  'raspberry-pi': raspberryPiFeatures,
  'rpi': raspberryPiFeatures,
  lite: raspberryPiFeatures,
  embedded: embeddedFeatures,
  iot: embeddedFeatures,
};

let cachedFeatures: FeatureFlags | null = null;

/**
 * Load feature flags based on environment or config
 *
 * Priority:
 * 1. MOLTBOT_PROFILE env var
 * 2. CLAWDBOT_PROFILE env var (legacy)
 * 3. Config file profile setting
 * 4. Auto-detect based on available memory
 * 5. Default profile
 */
export function loadFeatures(forceProfile?: string): FeatureFlags {
  if (cachedFeatures && !forceProfile) {
    return cachedFeatures;
  }

  const profile =
    forceProfile ||
    process.env.MOLTBOT_PROFILE ||
    process.env.CLAWDBOT_PROFILE ||
    detectProfile();

  const features = profiles[profile] || defaultFeatures;

  // Apply environment overrides
  const overridden = applyEnvOverrides(features);

  if (!forceProfile) {
    cachedFeatures = overridden;
  }

  return overridden;
}

/**
 * Auto-detect profile based on system resources
 */
function detectProfile(): string {
  // Check if running on Raspberry Pi
  if (isRaspberryPi()) {
    const totalMemMB = getTotalMemoryMB();
    if (totalMemMB < 600) {
      return 'raspberry-pi';
    }
  }

  return 'default';
}

/**
 * Check if running on Raspberry Pi
 */
function isRaspberryPi(): boolean {
  try {
    // Check /proc/device-tree/model on Linux
    if (process.platform === 'linux') {
      const fs = require('fs');
      const model = fs.readFileSync('/proc/device-tree/model', 'utf8');
      return model.toLowerCase().includes('raspberry pi');
    }
  } catch {
    // Not on Pi or can't read
  }
  return false;
}

/**
 * Get total system memory in MB
 */
function getTotalMemoryMB(): number {
  const os = require('os');
  return Math.round(os.totalmem() / (1024 * 1024));
}

/**
 * Apply environment variable overrides to features
 */
function applyEnvOverrides(features: FeatureFlags): FeatureFlags {
  const result = { ...features };

  // Browser override
  if (process.env.MOLTBOT_DISABLE_BROWSER === '1') {
    result.browser = false;
    result.tools = { ...result.tools, browser: false, webScrape: false, screenshot: false };
  }

  // Image processing override
  if (process.env.MOLTBOT_DISABLE_SHARP === '1') {
    result.imageProcessing = false;
    result.tools = { ...result.tools, imageEdit: false };
  }

  // TUI override
  if (process.env.MOLTBOT_DISABLE_TUI === '1') {
    result.tui = false;
  }

  // Channel overrides
  if (process.env.MOLTBOT_CHANNELS) {
    const enabledChannels = process.env.MOLTBOT_CHANNELS.split(',');
    result.channels = {
      whatsapp: enabledChannels.includes('whatsapp'),
      telegram: enabledChannels.includes('telegram'),
      discord: enabledChannels.includes('discord'),
      slack: enabledChannels.includes('slack'),
      signal: enabledChannels.includes('signal'),
      imessage: enabledChannels.includes('imessage'),
      line: enabledChannels.includes('line'),
      msteams: enabledChannels.includes('msteams'),
      matrix: enabledChannels.includes('matrix'),
      googlechat: enabledChannels.includes('googlechat'),
      webchat: enabledChannels.includes('webchat'),
    };
  }

  return result;
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const features = loadFeatures();
  return !!features[feature];
}

/**
 * Check if a specific channel is enabled
 */
export function isChannelEnabled(channel: keyof ChannelFeatures): boolean {
  const features = loadFeatures();
  return features.channels[channel];
}

/**
 * Check if a specific tool is enabled
 */
export function isToolEnabled(tool: keyof ToolFeatures): boolean {
  const features = loadFeatures();
  return features.tools[tool];
}

/**
 * Get current profile name
 */
export function getCurrentProfile(): string {
  return (
    process.env.MOLTBOT_PROFILE ||
    process.env.CLAWDBOT_PROFILE ||
    detectProfile()
  );
}

/**
 * Get memory-based recommendations
 */
export function getProfileRecommendation(): {
  profile: string;
  reason: string;
  memoryMB: number;
} {
  const memoryMB = getTotalMemoryMB();

  if (memoryMB < 600) {
    return {
      profile: 'raspberry-pi',
      reason: 'Low memory detected (<600MB)',
      memoryMB,
    };
  }

  if (memoryMB < 1500) {
    return {
      profile: 'lite',
      reason: 'Limited memory detected (<1.5GB)',
      memoryMB,
    };
  }

  return {
    profile: 'default',
    reason: 'Sufficient memory for full features',
    memoryMB,
  };
}

/**
 * Print feature summary for debugging
 */
export function printFeatureSummary(): void {
  const features = loadFeatures();
  const profile = getCurrentProfile();
  const memoryMB = getTotalMemoryMB();

  console.log(`\n=== Moltbot Feature Summary ===`);
  console.log(`Profile: ${profile}`);
  console.log(`Memory: ${memoryMB}MB`);
  console.log(`\nHeavy Features:`);
  console.log(`  Browser (Playwright): ${features.browser ? 'ON' : 'OFF'}`);
  console.log(`  Image Processing (Sharp): ${features.imageProcessing ? 'ON' : 'OFF'}`);
  console.log(`  PDF Parsing: ${features.pdfParsing ? 'ON' : 'OFF'}`);
  console.log(`  Local LLM: ${features.localLLM ? 'ON' : 'OFF'}`);
  console.log(`\nChannels:`);
  Object.entries(features.channels).forEach(([name, enabled]) => {
    console.log(`  ${name}: ${enabled ? 'ON' : 'OFF'}`);
  });
  console.log(`\nTools:`);
  Object.entries(features.tools).forEach(([name, enabled]) => {
    console.log(`  ${name}: ${enabled ? 'ON' : 'OFF'}`);
  });
  console.log(`================================\n`);
}
