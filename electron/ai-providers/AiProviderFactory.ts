import { AppConfig } from "../ConfigHelper";
import { ApiProvider } from "../../src/types/electron";
import { IAiProvider } from "./IAiProvider";
import { OpenAiProvider } from "./OpenAiProvider";
import { GeminiProvider } from "./GeminiProvider"; // Assumes GeminiProvider.ts exists
import { AnthropicProvider } from "./AnthropicProvider"; // Assumes AnthropicProvider.ts exists
import { OpenAI } from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from '@anthropic-ai/sdk';

export function createAiProvider(config: AppConfig): IAiProvider | null {
    if (!config.apiKey) {
        console.warn(`API key is missing. AI provider for "${config.apiProvider}" will not be created.`);
        return null;
    }

    try {
        switch (config.apiProvider) {
            case ApiProvider.OpenAI: {
                const openaiClient = new OpenAI({
                    apiKey: config.apiKey,
                    timeout: 60000,
                    maxRetries: 2
                });
                return new OpenAiProvider(openaiClient, config);
            }

            case ApiProvider.Gemini: {
                const geminiClient = new GoogleGenAI({ apiKey: config.apiKey });
                return new GeminiProvider(geminiClient, config);
            }

            case ApiProvider.Anthropic: {
                const anthropicClient = new Anthropic({
                    apiKey: config.apiKey,
                    timeout: 60000,
                    maxRetries: 2
                });
                return new AnthropicProvider(anthropicClient, config);
            }

            default:
                console.warn(`Unknown or unsupported API provider: "${config.apiProvider}"`);
                return null;
        }
    } catch (error) {
        console.error(`Failed to initialize AI provider for "${config.apiProvider}":`, error);
        return null;
    }
}