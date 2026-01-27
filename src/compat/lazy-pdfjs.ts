/**
 * Lazy-loading wrapper for pdfjs-dist
 *
 * Only loads pdfjs-dist when PDF parsing is enabled.
 * Returns stubs if PDF parsing is disabled.
 */

import { isFeatureEnabled, getCurrentProfile } from '../infra/features.js';

// Cached module reference
let pdfjsModule: typeof import('pdfjs-dist') | null = null;

/**
 * Error thrown when PDF parsing is disabled
 */
export class PDFParsingDisabledError extends Error {
  constructor() {
    super(
      `PDF parsing is disabled in profile "${getCurrentProfile()}". ` +
        `Set MOLTBOT_PROFILE=default or enable pdfParsing feature to use this functionality.`
    );
    this.name = 'PDFParsingDisabledError';
  }
}

/**
 * Check if PDF parsing is available
 */
export function isPDFParsingAvailable(): boolean {
  return isFeatureEnabled('pdfParsing');
}

/**
 * Lazily load pdfjs-dist module
 */
export async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!isFeatureEnabled('pdfParsing')) {
    throw new PDFParsingDisabledError();
  }

  if (!pdfjsModule) {
    try {
      pdfjsModule = await import('pdfjs-dist');
    } catch (error) {
      throw new Error(
        `Failed to load pdfjs-dist. Make sure it's installed: npm install pdfjs-dist\n` +
          `Original error: ${error}`
      );
    }
  }

  return pdfjsModule;
}

/**
 * PDF document interface (simplified)
 */
export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  getMetadata(): Promise<{
    info: Record<string, unknown>;
    metadata: unknown;
  }>;
  destroy(): Promise<void>;
}

export interface PDFPageProxy {
  pageNumber: number;
  getTextContent(): Promise<{
    items: Array<{ str: string; transform: number[] }>;
  }>;
  getViewport(params: { scale: number }): { width: number; height: number };
}

/**
 * Load a PDF document
 */
export async function loadPDFDocument(
  source: string | Uint8Array | ArrayBuffer
): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument(source);
  return loadingTask.promise as unknown as Promise<PDFDocumentProxy>;
}

/**
 * Extract text from a PDF
 */
export async function extractPDFText(
  source: string | Uint8Array | ArrayBuffer
): Promise<string> {
  const doc = await loadPDFDocument(source);
  const textParts: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    textParts.push(pageText);
  }

  await doc.destroy();
  return textParts.join('\n\n');
}

/**
 * Get PDF metadata
 */
export async function getPDFMetadata(
  source: string | Uint8Array | ArrayBuffer
): Promise<{
  numPages: number;
  info: Record<string, unknown>;
}> {
  const doc = await loadPDFDocument(source);
  const metadata = await doc.getMetadata();
  const result = {
    numPages: doc.numPages,
    info: metadata.info,
  };
  await doc.destroy();
  return result;
}

/**
 * Stub implementations for when PDF parsing is disabled
 */
export const pdfStubs = {
  async loadPdfjs(): Promise<never> {
    throw new PDFParsingDisabledError();
  },

  async loadPDFDocument(): Promise<never> {
    throw new PDFParsingDisabledError();
  },

  async extractPDFText(): Promise<{ error: string }> {
    return {
      error:
        `PDF parsing disabled in "${getCurrentProfile()}" profile. ` +
        `Upload the PDF to Claude directly for analysis.`,
    };
  },

  async getPDFMetadata(): Promise<{ error: string }> {
    return {
      error: `PDF parsing disabled in "${getCurrentProfile()}" profile.`,
    };
  },

  isPDFParsingAvailable(): boolean {
    return false;
  },
};

/**
 * Get the appropriate PDF interface based on feature flags
 */
export function getPDFInterface() {
  if (isFeatureEnabled('pdfParsing')) {
    return {
      loadPdfjs,
      loadPDFDocument,
      extractPDFText,
      getPDFMetadata,
      isPDFParsingAvailable,
    };
  }

  return pdfStubs;
}
