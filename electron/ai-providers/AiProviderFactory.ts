import { AppConfig } from "../ConfigHelper";
import { ApiProvider } from "../../src/types/electron";
import { IAiProvider } from "./IAiProvider";
import { OpenAiProvider } from "./OpenAiProvider";
import { GeminiProvider } from "./GeminiProvider"; // Assumes GeminiProvider.ts exists
import { AnthropicProvider } from "./AnthropicProvider"; // Assumes AnthropicProvider.ts exists
import { OpenAI } from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from '@anthropic-ai/sdk';

// Provider factory registry - easily extensible
interface ProviderFactory {
  createClient: (apiKey: string) => any;
  createProvider: (client: any, config: AppConfig) => IAiProvider;
}

const providerFactories: Record<ApiProvider, ProviderFactory> = {
  [ApiProvider.OpenAI]: {
    createClient: (apiKey: string) => new OpenAI({
      apiKey,
      timeout: 60000,
      maxRetries: 2
    }),
    createProvider: (client: OpenAI, config: AppConfig) => new OpenAiProvider(client, config)
  },
  [ApiProvider.Gemini]: {
    createClient: (apiKey: string) => new GoogleGenAI({ apiKey }),
    createProvider: (client: GoogleGenAI, config: AppConfig) => new GeminiProvider(client, config)
  },
  [ApiProvider.Anthropic]: {
    createClient: (apiKey: string) => new Anthropic({
      apiKey,
      timeout: 60000,
      maxRetries: 2
    }),
    createProvider: (client: Anthropic, config: AppConfig) => new AnthropicProvider(client, config)
  }
};

export function createAiProvider(config: AppConfig): IAiProvider | null {
    const apiKey = config.apiKeys[config.apiProvider];
    if (!apiKey) {
        console.warn(`API key is missing for ${config.apiProvider}. AI provider will not be created.`);
        return null;
    }

    const factory = providerFactories[config.apiProvider];
    if (!factory) {
        console.warn(`Unknown or unsupported API provider: "${config.apiProvider}"`);
        return null;
    }

    try {
        const client = factory.createClient(apiKey);
        return factory.createProvider(client, config);
    } catch (error) {
        console.error(`Failed to initialize AI provider for "${config.apiProvider}":`, error);
        return null;
    }
}

/**
 * Register a new provider factory (for future extensibility)
 */
export function registerProviderFactory(
    provider: ApiProvider, 
    factory: ProviderFactory
): void {
    providerFactories[provider] = factory;
}