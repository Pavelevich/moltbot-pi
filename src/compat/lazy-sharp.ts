/**
 * Lazy-loading wrapper for Sharp
 *
 * Only loads sharp when actually needed.
 * Falls back to basic operations or API when disabled.
 */

import { isFeatureEnabled, getCurrentProfile } from '../infra/features.js';

// Sharp types (simplified)
export interface SharpInstance {
  resize(width?: number, height?: number, options?: ResizeOptions): SharpInstance;
  jpeg(options?: JpegOptions): SharpInstance;
  png(options?: PngOptions): SharpInstance;
  webp(options?: WebpOptions): SharpInstance;
  toBuffer(): Promise<Buffer>;
  toFile(path: string): Promise<OutputInfo>;
  metadata(): Promise<Metadata>;
  rotate(angle?: number): SharpInstance;
  flip(): SharpInstance;
  flop(): SharpInstance;
  grayscale(): SharpInstance;
  blur(sigma?: number): SharpInstance;
}

export interface ResizeOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  position?: string;
  background?: string | { r: number; g: number; b: number; alpha: number };
  withoutEnlargement?: boolean;
}

export interface JpegOptions {
  quality?: number;
  progressive?: boolean;
}

export interface PngOptions {
  compressionLevel?: number;
  progressive?: boolean;
}

export interface WebpOptions {
  quality?: number;
  lossless?: boolean;
}

export interface OutputInfo {
  format: string;
  width: number;
  height: number;
  channels: number;
  size: number;
}

export interface Metadata {
  format?: string;
  width?: number;
  height?: number;
  space?: string;
  channels?: number;
  depth?: string;
  density?: number;
  hasAlpha?: boolean;
  orientation?: number;
}

// Cached module reference
let sharpModule: ((input?: Buffer | string) => SharpInstance) | null = null;

/**
 * Error thrown when image processing is disabled
 */
export class ImageProcessingDisabledError extends Error {
  constructor() {
    super(
      `Image processing is disabled in profile "${getCurrentProfile()}". ` +
        `Set MOLTBOT_PROFILE=default or enable imageProcessing feature. ` +
        `Alternatively, use Claude Vision API for image analysis.`
    );
    this.name = 'ImageProcessingDisabledError';
  }
}

/**
 * Check if image processing is available
 */
export function isImageProcessingAvailable(): boolean {
  return isFeatureEnabled('imageProcessing');
}

/**
 * Lazily load sharp module
 */
async function loadSharp(): Promise<(input?: Buffer | string) => SharpInstance> {
  if (!isFeatureEnabled('imageProcessing')) {
    throw new ImageProcessingDisabledError();
  }

  if (!sharpModule) {
    try {
      const mod = await import('sharp');
      sharpModule = mod.default as unknown as (input?: Buffer | string) => SharpInstance;
    } catch (error) {
      throw new Error(
        `Failed to load sharp. Make sure it's installed: npm install sharp\n` +
          `On some platforms, you may need to install additional dependencies.\n` +
          `Original error: ${error}`
      );
    }
  }

  return sharpModule;
}

/**
 * Create sharp instance with lazy loading
 */
export async function createSharpInstance(input?: Buffer | string): Promise<SharpInstance> {
  const sharp = await loadSharp();
  return sharp(input);
}

/**
 * Resize an image
 */
export async function resizeImage(
  input: Buffer | string,
  width?: number,
  height?: number,
  options?: ResizeOptions
): Promise<Buffer> {
  const instance = await createSharpInstance(input);
  return instance.resize(width, height, options).toBuffer();
}

/**
 * Convert image format
 */
export async function convertImage(
  input: Buffer | string,
  format: 'jpeg' | 'png' | 'webp',
  options?: JpegOptions | PngOptions | WebpOptions
): Promise<Buffer> {
  const instance = await createSharpInstance(input);

  switch (format) {
    case 'jpeg':
      return instance.jpeg(options as JpegOptions).toBuffer();
    case 'png':
      return instance.png(options as PngOptions).toBuffer();
    case 'webp':
      return instance.webp(options as WebpOptions).toBuffer();
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Get image metadata
 */
export async function getImageMetadata(input: Buffer | string): Promise<Metadata> {
  const instance = await createSharpInstance(input);
  return instance.metadata();
}

/**
 * Stub implementations for when image processing is disabled
 */
export const imageStubs = {
  async createSharpInstance(): Promise<never> {
    throw new ImageProcessingDisabledError();
  },

  async resizeImage(): Promise<{ error: string }> {
    return {
      error: `Image processing disabled in "${getCurrentProfile()}" profile. ` +
        `Use Claude Vision API for image analysis instead.`,
    };
  },

  async convertImage(): Promise<{ error: string }> {
    return {
      error: `Image processing disabled in "${getCurrentProfile()}" profile.`,
    };
  },

  async getImageMetadata(input: Buffer | string): Promise<Partial<Metadata>> {
    // Try to get basic info from buffer without sharp
    if (Buffer.isBuffer(input)) {
      return {
        format: detectImageFormat(input),
        // Can't determine dimensions without sharp
      };
    }
    return {};
  },

  isImageProcessingAvailable(): boolean {
    return false;
  },
};

/**
 * Detect image format from buffer magic bytes
 */
function detectImageFormat(buffer: Buffer): string | undefined {
  if (buffer.length < 4) return undefined;

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }

  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'gif';
  }

  // WebP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return undefined;
}

/**
 * Get the appropriate image interface based on feature flags
 */
export function getImageInterface() {
  if (isFeatureEnabled('imageProcessing')) {
    return {
      createSharpInstance,
      resizeImage,
      convertImage,
      getImageMetadata,
      isImageProcessingAvailable,
    };
  }

  return imageStubs;
}

/**
 * Alternative: Use native macOS sips command for basic operations
 * Only works on macOS, but doesn't require sharp
 */
export async function resizeWithSips(
  inputPath: string,
  outputPath: string,
  maxWidth: number,
  maxHeight: number
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('sips is only available on macOS');
  }

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // sips can resize images on macOS without external deps
  await execAsync(
    `sips -Z ${Math.max(maxWidth, maxHeight)} "${inputPath}" --out "${outputPath}"`
  );
}
