/**
 * Compatibility Layer for Moltbot
 *
 * Provides lazy-loading wrappers for heavy dependencies.
 * This allows Moltbot to run on resource-constrained devices
 * like Raspberry Pi Zero 2W by only loading modules when needed.
 *
 * Usage:
 *   import { getImageInterface, getBrowserInterface } from './compat/index.js';
 *
 *   const imageOps = getImageInterface();
 *   if (imageOps.isImageProcessingAvailable()) {
 *     const buffer = await imageOps.resizeImage(input, 800, 600);
 *   }
 */

// Re-export all lazy loading modules
export {
  // Playwright (Browser automation)
  launchBrowser,
  getBrowser,
  closeBrowser,
  newPage,
  isBrowserAvailable,
  getBrowserInterface,
  browserStubs,
  BrowserDisabledError,
  type Browser,
  type BrowserContext,
  type Page,
} from './lazy-playwright.js';

export {
  // Sharp (Image processing)
  createSharpInstance,
  resizeImage,
  convertImage,
  getImageMetadata,
  isImageProcessingAvailable,
  getImageInterface,
  imageStubs,
  resizeWithSips,
  ImageProcessingDisabledError,
  type SharpInstance,
  type ResizeOptions,
  type JpegOptions,
  type PngOptions,
  type WebpOptions,
  type OutputInfo,
  type Metadata,
} from './lazy-sharp.js';

export {
  // Baileys (WhatsApp)
  loadBaileys,
  createWhatsAppSocket,
  isWhatsAppAvailable,
  getWhatsAppInterface,
  whatsAppStubs,
  WhatsAppDisabledError,
} from './lazy-baileys.js';

export {
  // pdfjs-dist (PDF parsing)
  loadPdfjs,
  loadPDFDocument,
  extractPDFText,
  getPDFMetadata,
  isPDFParsingAvailable,
  getPDFInterface,
  pdfStubs,
  PDFParsingDisabledError,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from './lazy-pdfjs.js';

export {
  // node-llama-cpp (Local LLM)
  loadLlama,
  loadModel,
  generateLocalEmbeddings,
  generateCompletion,
  isLocalLLMAvailable,
  getLlamaInterface,
  llamaStubs,
  checkLocalLLMRequirements,
  LocalLLMDisabledError,
  type LlamaModel,
  type LlamaContext,
  type LlamaEmbedding,
  type LlamaModelOptions,
} from './lazy-llama.js';

// Re-export feature flags for convenience
export {
  loadFeatures,
  isFeatureEnabled,
  isChannelEnabled,
  isToolEnabled,
  getCurrentProfile,
  getProfileRecommendation,
  printFeatureSummary,
  type FeatureFlags,
  type ChannelFeatures,
  type ToolFeatures,
} from '../infra/features.js';

/**
 * Get all available interfaces based on current feature flags
 */
export function getAllInterfaces() {
  return {
    browser: getBrowserInterface(),
    image: getImageInterface(),
    whatsapp: getWhatsAppInterface(),
    pdf: getPDFInterface(),
    llama: getLlamaInterface(),
  };
}

/**
 * Check which heavy features are available
 */
export function getAvailableFeatures(): {
  browser: boolean;
  imageProcessing: boolean;
  whatsapp: boolean;
  pdfParsing: boolean;
  localLLM: boolean;
} {
  return {
    browser: isBrowserAvailable(),
    imageProcessing: isImageProcessingAvailable(),
    whatsapp: isWhatsAppAvailable(),
    pdfParsing: isPDFParsingAvailable(),
    localLLM: isLocalLLMAvailable(),
  };
}

/**
 * Print a summary of available features (useful for debugging)
 */
export function printCompatSummary(): void {
  const features = getAvailableFeatures();
  const profile = getCurrentProfile();

  console.log(`\n=== Moltbot Compatibility Layer ===`);
  console.log(`Profile: ${profile}`);
  console.log(`\nHeavy Dependencies:`);
  console.log(`  Browser (Playwright):     ${features.browser ? 'LOADED' : 'STUB'}`);
  console.log(`  Image Processing (Sharp): ${features.imageProcessing ? 'LOADED' : 'STUB'}`);
  console.log(`  WhatsApp (Baileys):       ${features.whatsapp ? 'LOADED' : 'STUB'}`);
  console.log(`  PDF Parsing (pdfjs):      ${features.pdfParsing ? 'LOADED' : 'STUB'}`);
  console.log(`  Local LLM (llama.cpp):    ${features.localLLM ? 'LOADED' : 'STUB'}`);
  console.log(`===================================\n`);
}
