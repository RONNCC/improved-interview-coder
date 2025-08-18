
export enum ElectronApiProvider {
  OpenAI = "openai",
  Gemini = "gemini",
  Anthropic = "anthropic"
}

export interface ProviderBackendConfig {
  models: string[];
  defaultModel: string;
  keyPrefix: string;
  keyPattern: RegExp;
  displayName: string;
  description: string;
}

// Backend configurations (for ConfigHelper)
export const PROVIDER_BACKEND_CONFIGS: Record<ElectronApiProvider, ProviderBackendConfig> = {
  [ElectronApiProvider.OpenAI]: {
    models: [
      "gpt-4.1",
      "o4-mini",
      "chatgpt-4o-latest",
      "gpt-4o",
      "gpt-4o-2024-11-20",
      "gpt-3.5-turbo",
      "o3",
      "gpt-4.5-preview-2025-02-27",
      "gpt-4.1-mini",
      "gpt-5-mini",
      "gpt-5"
    ],
    defaultModel: "gpt-4o",
    keyPrefix: "sk-",
    keyPattern: /^sk-[a-zA-Z0-9]{32,}$/,
    displayName: "OpenAI",
    description: "GPT-4o models"
  },
  [ElectronApiProvider.Gemini]: {
    models: [
      "gemini-2.5-pro-preview-05-06",
      "gemini-2.0-flash",
      "gemini-2.5-flash-preview-05-20"
    ],
    defaultModel: "gemini-2.0-flash",
    keyPrefix: "",
    keyPattern: /^[a-zA-Z0-9]{10,}$/,
    displayName: "Gemini",
    description: "Gemini 1.5 models"
  },
  [ElectronApiProvider.Anthropic]: {
    models: [
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229"
    ],
    defaultModel: "claude-3-7-sonnet-20250219",
    keyPrefix: "sk-ant-",
    keyPattern: /^sk-ant-[a-zA-Z0-9]{32,}$/,
    displayName: "Anthropic",
    description: "Claude models"
  }
};

/**
 * Register a new provider configuration (for future extensibility)
 */
export function registerBackendProviderConfig(
  provider: ElectronApiProvider,
  backendConfig: ProviderBackendConfig
): void {
  PROVIDER_BACKEND_CONFIGS[provider] = backendConfig;
}

/**
 * Get all registered providers
 */
export function getRegisteredBackendProviders(): ElectronApiProvider[] {
  return Object.keys(PROVIDER_BACKEND_CONFIGS) as ElectronApiProvider[];
}
 