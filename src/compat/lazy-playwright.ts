/**
 * Lazy-loading wrapper for Playwright
 *
 * Only loads playwright-core when actually needed.
 * Returns stubs if browser feature is disabled.
 */

import { isFeatureEnabled, getCurrentProfile } from '../infra/features.js';

// Types from playwright-core
export interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
  contexts(): BrowserContext[];
}

export interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
  pages(): Page[];
}

export interface Page {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<void>;
  content(): Promise<string>;
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  $eval<T>(selector: string, fn: (el: Element) => T): Promise<T>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  title(): Promise<string>;
  url(): string;
}

// Cached module reference
let playwrightModule: typeof import('playwright-core') | null = null;
let browser: Browser | null = null;

/**
 * Error thrown when browser features are disabled
 */
export class BrowserDisabledError extends Error {
  constructor() {
    super(
      `Browser automation is disabled in profile "${getCurrentProfile()}". ` +
        `Set MOLTBOT_PROFILE=default or enable browser feature to use this functionality.`
    );
    this.name = 'BrowserDisabledError';
  }
}

/**
 * Check if browser is available
 */
export function isBrowserAvailable(): boolean {
  return isFeatureEnabled('browser');
}

/**
 * Lazily load playwright-core module
 */
async function loadPlaywright(): Promise<typeof import('playwright-core')> {
  if (!isFeatureEnabled('browser')) {
    throw new BrowserDisabledError();
  }

  if (!playwrightModule) {
    try {
      playwrightModule = await import('playwright-core');
    } catch (error) {
      throw new Error(
        `Failed to load playwright-core. Make sure it's installed: npm install playwright-core\n` +
          `Original error: ${error}`
      );
    }
  }

  return playwrightModule;
}

/**
 * Launch browser with lazy loading
 */
export async function launchBrowser(options?: {
  headless?: boolean;
  executablePath?: string;
}): Promise<Browser> {
  const playwright = await loadPlaywright();

  if (browser) {
    return browser;
  }

  browser = await playwright.chromium.launch({
    headless: options?.headless ?? true,
    executablePath: options?.executablePath,
  });

  return browser;
}

/**
 * Get or launch browser
 */
export async function getBrowser(): Promise<Browser> {
  if (browser) {
    return browser;
  }
  return launchBrowser();
}

/**
 * Close browser if open
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Create a new page
 */
export async function newPage(): Promise<Page> {
  const b = await getBrowser();
  return b.newPage();
}

/**
 * Stub implementations for when browser is disabled
 */
export const browserStubs = {
  async launchBrowser(): Promise<never> {
    throw new BrowserDisabledError();
  },

  async getBrowser(): Promise<never> {
    throw new BrowserDisabledError();
  },

  async newPage(): Promise<never> {
    throw new BrowserDisabledError();
  },

  async screenshot(_url: string): Promise<{ error: string }> {
    return {
      error: `Browser automation disabled in "${getCurrentProfile()}" profile. Cannot take screenshots.`,
    };
  },

  async scrape(_url: string): Promise<{ error: string }> {
    return {
      error: `Browser automation disabled in "${getCurrentProfile()}" profile. Cannot scrape web pages.`,
    };
  },

  isBrowserAvailable(): boolean {
    return false;
  },
};

/**
 * Get the appropriate browser interface based on feature flags
 */
export function getBrowserInterface() {
  if (isFeatureEnabled('browser')) {
    return {
      launchBrowser,
      getBrowser,
      closeBrowser,
      newPage,
      isBrowserAvailable,
    };
  }

  return browserStubs;
}
