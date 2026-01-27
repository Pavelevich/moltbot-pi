/**
 * Lazy-loading wrapper for Baileys (WhatsApp Web)
 *
 * Only loads @whiskeysockets/baileys when WhatsApp channel is enabled.
 * Returns stubs if WhatsApp is disabled.
 */

import { isChannelEnabled, getCurrentProfile } from '../infra/features.js';

// Cached module reference
let baileysModule: typeof import('@whiskeysockets/baileys') | null = null;

/**
 * Error thrown when WhatsApp is disabled
 */
export class WhatsAppDisabledError extends Error {
  constructor() {
    super(
      `WhatsApp channel is disabled in profile "${getCurrentProfile()}". ` +
        `Enable WhatsApp in config or use MOLTBOT_CHANNELS=whatsapp to enable it.`
    );
    this.name = 'WhatsAppDisabledError';
  }
}

/**
 * Check if WhatsApp is available
 */
export function isWhatsAppAvailable(): boolean {
  return isChannelEnabled('whatsapp');
}

/**
 * Lazily load Baileys module
 */
export async function loadBaileys(): Promise<typeof import('@whiskeysockets/baileys')> {
  if (!isChannelEnabled('whatsapp')) {
    throw new WhatsAppDisabledError();
  }

  if (!baileysModule) {
    try {
      baileysModule = await import('@whiskeysockets/baileys');
    } catch (error) {
      throw new Error(
        `Failed to load @whiskeysockets/baileys. Make sure it's installed.\n` +
          `Original error: ${error}`
      );
    }
  }

  return baileysModule;
}

/**
 * Create WhatsApp socket with lazy loading
 */
export async function createWhatsAppSocket(config: {
  auth: unknown;
  printQRInTerminal?: boolean;
  browser?: [string, string, string];
}) {
  const baileys = await loadBaileys();
  return baileys.makeWASocket({
    auth: config.auth as any,
    printQRInTerminal: config.printQRInTerminal,
    browser: config.browser,
  });
}

/**
 * Stub implementations for when WhatsApp is disabled
 */
export const whatsAppStubs = {
  async loadBaileys(): Promise<never> {
    throw new WhatsAppDisabledError();
  },

  async createWhatsAppSocket(): Promise<never> {
    throw new WhatsAppDisabledError();
  },

  isWhatsAppAvailable(): boolean {
    return false;
  },

  getDisabledMessage(): string {
    return `WhatsApp is disabled in "${getCurrentProfile()}" profile. ` +
      `Consider using Telegram instead (lightweight and works on Pi).`;
  },
};

/**
 * Get the appropriate WhatsApp interface based on feature flags
 */
export function getWhatsAppInterface() {
  if (isChannelEnabled('whatsapp')) {
    return {
      loadBaileys,
      createWhatsAppSocket,
      isWhatsAppAvailable,
    };
  }

  return whatsAppStubs;
}
