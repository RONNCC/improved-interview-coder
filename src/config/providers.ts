import { ApiProvider } from "../types";

export interface ProviderUIConfig {
  displayName: string;
  description: string;
  placeholder: string;
  helpText: string;
  setupSteps: string[];
  setupUrl: string;
  defaultModels: {
    extractionModel: string;
    solutionModel: string;
    debuggingModel: string;
  };
}

// Centralized provider configurations
export const PROVIDER_CONFIGS: Record<ApiProvider, ProviderUIConfig> = {
  [ApiProvider.OpenAI]: {
    displayName: "OpenAI",
    description: "GPT-4o models",
    placeholder: "sk-...",
    helpText: "Your API key is stored locally and never sent to any server except OpenAI",
    setupSteps: [
      "1. Create an account at ",
      "2. Add payment method to your account",
      "3. Create a new secret key and paste it here"
    ],
    setupUrl: "https://platform.openai.com/api-keys",
    defaultModels: {
      extractionModel: "gpt-4o",
      solutionModel: "gpt-4.1",
      debuggingModel: "gpt-4.1"
    }
  },
  [ApiProvider.Gemini]: {
    displayName: "Gemini",
    description: "Gemini 1.5 models",
    placeholder: "Enter your Gemini API key",
    helpText: "Your API key is stored locally and never sent to any server except Google",
    setupSteps: [
      "1. Create an account at ",
      "2. Enable the Gemini API",
      "3. Create an API key and paste it here"
    ],
    setupUrl: "https://makersuite.google.com/app/apikey",
    defaultModels: {
      extractionModel: "gemini-2.5-flash-preview-05-20",
      solutionModel: "gemini-2.5-flash-preview-05-20",
      debuggingModel: "gemini-2.5-flash-preview-05-20"
    }
  },
  [ApiProvider.Anthropic]: {
    displayName: "Anthropic",
    description: "Claude models",
    placeholder: "sk-ant-...",
    helpText: "Your API key is stored locally and never sent to any server except Anthropic",
    setupSteps: [
      "1. Create an account at ",
      "2. Add payment method to your account",
      "3. Create a new API key and paste it here"
    ],
    setupUrl: "https://console.anthropic.com/",
    defaultModels: {
      extractionModel: "claude-3-7-sonnet-20250219",
      solutionModel: "claude-3-7-sonnet-20250219",
      debuggingModel: "claude-3-7-sonnet-20250219"
    }
  }
};

/**
 * Register a new provider configuration (for future extensibility)
 */
export function registerProviderConfig(
  provider: ApiProvider,
  uiConfig: ProviderUIConfig
): void {
  PROVIDER_CONFIGS[provider] = uiConfig;
}

/**
 * Get all registered providers
 */
export function getRegisteredProviders(): ApiProvider[] {
  return Object.keys(PROVIDER_CONFIGS) as ApiProvider[];
} 