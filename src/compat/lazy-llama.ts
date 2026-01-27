/**
 * Lazy-loading wrapper for node-llama-cpp
 *
 * Only loads node-llama-cpp when local LLM features are enabled.
 * Returns stubs if local LLM is disabled.
 */

import { isFeatureEnabled, getCurrentProfile } from '../infra/features.js';

// Cached module reference
let llamaModule: typeof import('node-llama-cpp') | null = null;

/**
 * Error thrown when local LLM is disabled
 */
export class LocalLLMDisabledError extends Error {
  constructor() {
    super(
      `Local LLM is disabled in profile "${getCurrentProfile()}". ` +
        `Set MOLTBOT_PROFILE=default and enable localLLM feature to use this functionality. ` +
        `Alternatively, use API-based embeddings with OpenAI or Anthropic.`
    );
    this.name = 'LocalLLMDisabledError';
  }
}

/**
 * Check if local LLM is available
 */
export function isLocalLLMAvailable(): boolean {
  return isFeatureEnabled('localLLM');
}

/**
 * Lazily load node-llama-cpp module
 */
export async function loadLlama(): Promise<typeof import('node-llama-cpp')> {
  if (!isFeatureEnabled('localLLM')) {
    throw new LocalLLMDisabledError();
  }

  if (!llamaModule) {
    try {
      llamaModule = await import('node-llama-cpp');
    } catch (error) {
      throw new Error(
        `Failed to load node-llama-cpp. Make sure it's installed: npm install node-llama-cpp\n` +
          `This package requires a C++ compiler and may not work on all platforms.\n` +
          `Original error: ${error}`
      );
    }
  }

  return llamaModule;
}

/**
 * Simplified interfaces for node-llama-cpp
 */
export interface LlamaModel {
  dispose(): void;
}

export interface LlamaContext {
  dispose(): void;
}

export interface LlamaEmbedding {
  vector: number[];
}

export interface LlamaModelOptions {
  modelPath: string;
  gpuLayers?: number;
  contextSize?: number;
}

/**
 * Load a local LLM model
 */
export async function loadModel(options: LlamaModelOptions): Promise<{
  model: LlamaModel;
  context: LlamaContext;
}> {
  const llama = await loadLlama();

  // node-llama-cpp v3 API
  const llamaInstance = await llama.getLlama();
  const model = await llamaInstance.loadModel({
    modelPath: options.modelPath,
  });

  const context = await model.createContext({
    contextSize: options.contextSize,
  });

  return { model, context };
}

/**
 * Generate embeddings using local model
 */
export async function generateLocalEmbeddings(
  model: LlamaModel,
  text: string
): Promise<number[]> {
  const llama = await loadLlama();

  // Use the embedding context from node-llama-cpp
  const llamaInstance = await llama.getLlama();
  const embeddingContext = await (model as any).createEmbeddingContext();

  const embedding = await embeddingContext.getEmbeddingFor(text);
  return Array.from(embedding.vector);
}

/**
 * Generate text completion using local model
 */
export async function generateCompletion(
  context: LlamaContext,
  prompt: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  }
): Promise<string> {
  const llama = await loadLlama();

  // This is a simplified interface - actual implementation depends on node-llama-cpp version
  const session = new (llama as any).LlamaChatSession({
    contextSequence: (context as any).getSequence(),
  });

  const response = await session.prompt(prompt, {
    maxTokens: options?.maxTokens ?? 512,
    temperature: options?.temperature ?? 0.7,
    topP: options?.topP ?? 0.9,
  });

  return response;
}

/**
 * Stub implementations for when local LLM is disabled
 */
export const llamaStubs = {
  async loadLlama(): Promise<never> {
    throw new LocalLLMDisabledError();
  },

  async loadModel(): Promise<never> {
    throw new LocalLLMDisabledError();
  },

  async generateLocalEmbeddings(): Promise<{ error: string; fallback: string }> {
    return {
      error: `Local LLM disabled in "${getCurrentProfile()}" profile.`,
      fallback: 'Use OpenAI or Anthropic API for embeddings instead.',
    };
  },

  async generateCompletion(): Promise<{ error: string; fallback: string }> {
    return {
      error: `Local LLM disabled in "${getCurrentProfile()}" profile.`,
      fallback: 'Use Claude or GPT API for text generation instead.',
    };
  },

  isLocalLLMAvailable(): boolean {
    return false;
  },

  getRecommendation(): string {
    return (
      `Local LLM is disabled in "${getCurrentProfile()}" profile. ` +
      `For embeddings, use MEMORY_PROVIDER=openai in your config. ` +
      `For text generation, use Claude or GPT API.`
    );
  },
};

/**
 * Get the appropriate LLM interface based on feature flags
 */
export function getLlamaInterface() {
  if (isFeatureEnabled('localLLM')) {
    return {
      loadLlama,
      loadModel,
      generateLocalEmbeddings,
      generateCompletion,
      isLocalLLMAvailable,
    };
  }

  return llamaStubs;
}

/**
 * Check system requirements for local LLM
 */
export function checkLocalLLMRequirements(): {
  available: boolean;
  requirements: string[];
  warnings: string[];
} {
  const requirements: string[] = [];
  const warnings: string[] = [];

  // Check available memory
  const os = require('os');
  const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMB = Math.round(os.freemem() / (1024 * 1024));

  if (totalMemMB < 4096) {
    requirements.push(`At least 4GB RAM required (you have ${totalMemMB}MB)`);
  }

  if (freeMemMB < 2048) {
    warnings.push(`Low available memory: ${freeMemMB}MB free`);
  }

  // Check platform
  if (process.platform === 'linux' && process.arch === 'arm64') {
    warnings.push('ARM64 Linux may have limited model support');
  }

  return {
    available: requirements.length === 0,
    requirements,
    warnings,
  };
}
