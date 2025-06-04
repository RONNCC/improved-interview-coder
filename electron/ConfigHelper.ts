// ConfigHelper.ts
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "events";
import { OpenAI } from "openai";
// Import Anthropic and Gemini clients if you have them for actual API calls
// import Anthropic from '@anthropic-ai/sdk'; // Example
// import { GoogleGenerativeAI } from "@google/generative-ai"; // Example

// --- Interfaces and Types ---
type ApiProvider = "openai" | "gemini" | "anthropic";

interface Config {
  apiKey: string;
  apiProvider: ApiProvider;
  extractionModel: string;
  solutionModel: string;
  debuggingModel: string;
  language: string;
  opacity: number;
}

// --- Provider Specific Configurations ---
interface ProviderDetails {
  defaultModel: string;
  allowedModels: readonly string[];
  apiKeyPrefix?: string;
  apiKeyValidationRegex: RegExp;
  testKeyFunction: (apiKey: string) => Promise<{ valid: boolean; error?: string }>;
}

const PROVIDER_CONFIGS: Readonly<Record<ApiProvider, ProviderDetails>> = {
  openai: {
    defaultModel: "gpt-4o",
    allowedModels: ["gpt-4o", "gpt-4o-mini"] as const,
    apiKeyPrefix: "sk-", // Generic sk- prefix
    apiKeyValidationRegex: /^sk-[a-zA-Z0-9]{32,}$/,
    testKeyFunction: async (apiKey) => {
      try {
        const openai = new OpenAI({ apiKey });
        await openai.models.list();
        return { valid: true };
      } catch (error: any) {
        let msg = "Unknown error validating OpenAI API key";
        if (error.status === 401) msg = "Invalid API key. Please check your OpenAI key.";
        else if (error.status === 429) msg = "Rate limit or quota exceeded for OpenAI API key.";
        else if (error.status === 500) msg = "OpenAI server error. Please try again later.";
        else if (error.message) msg = `Error: ${error.message}`;
        return { valid: false, error: msg };
      }
    },
  },
  gemini: {
    defaultModel: "gemini-2.0-flash",
    allowedModels: ["gemini-1.5-pro", "gemini-2.0-flash"] as const,
    apiKeyValidationRegex: /^.{10,}$/, // Basic length check, Gemini keys don't have a standard prefix
    testKeyFunction: async (apiKey) => { // Placeholder - replace with actual Gemini client validation
      if (apiKey && apiKey.trim().length >= 20) { // Arbitrary length for placeholder
        // Example: const genAI = new GoogleGenerativeAI(apiKey); await genAI.getGenerativeModel({ model: "gemini-pro" }).generateContent("test");
        return { valid: true };
      }
      return { valid: false, error: "Invalid Gemini API key format (placeholder check)." };
    },
  },
  anthropic: {
    defaultModel: "claude-3-7-sonnet-20250219",
    allowedModels: ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"] as const,
    apiKeyPrefix: "sk-ant-",
    apiKeyValidationRegex: /^sk-ant-(api\d{2}-)?[a-zA-Z0-9_-]{30,}$/, // More flexible Anthropic key regex
    testKeyFunction: async (apiKey) => { // Placeholder - replace with actual Anthropic client validation
      if (PROVIDER_CONFIGS.anthropic.apiKeyValidationRegex.test(apiKey.trim())) {
         // Example: const anthropic = new Anthropic({ apiKey }); await anthropic.countTokens("test");
        return { valid: true };
      }
      return { valid: false, error: "Invalid Anthropic API key format (placeholder check)." };
    },
  },
};

const DEFAULT_PROVIDER: ApiProvider = "gemini";

export class ConfigHelper extends EventEmitter {
  private readonly configPath: string;
  private readonly defaultConfig: Readonly<Config>;

  constructor() {
    super();
    try {
      this.configPath = path.join(app.getPath("userData"), "config.json");
    } catch (err) {
      console.warn("Could not access user data path, using fallback:", process.cwd());
      this.configPath = path.join(process.cwd(), "config.json");
    }

    const defaultProviderConfig = PROVIDER_CONFIGS[DEFAULT_PROVIDER];
    this.defaultConfig = Object.freeze({
      apiKey: "",
      apiProvider: DEFAULT_PROVIDER,
      extractionModel: defaultProviderConfig.defaultModel,
      solutionModel: defaultProviderConfig.defaultModel,
      debuggingModel: defaultProviderConfig.defaultModel,
      language: "python",
      opacity: 1.0,
    });

    this.ensureConfigExists();
  }

  private ensureConfigExists(): void {
    if (!fs.existsSync(this.configPath)) {
      this.saveConfigInternal(this.defaultConfig);
    }
  }

  private sanitizeModel(model: string | undefined, provider: ApiProvider): string {
    const providerConfig = PROVIDER_CONFIGS[provider];
    if (model && providerConfig.allowedModels.includes(model as any)) {
      return model;
    }
    if (model) { // Only warn if a model was provided but invalid
        console.warn(`Invalid ${provider} model: ${model}. Using default: ${providerConfig.defaultModel}`);
    }
    return providerConfig.defaultModel;
  }

  private detectProviderFromApiKey(apiKey: string): ApiProvider {
    const trimmedKey = apiKey.trim();
    if (PROVIDER_CONFIGS.anthropic.apiKeyPrefix && trimmedKey.startsWith(PROVIDER_CONFIGS.anthropic.apiKeyPrefix!)) return "anthropic";
    if (PROVIDER_CONFIGS.openai.apiKeyPrefix && trimmedKey.startsWith(PROVIDER_CONFIGS.openai.apiKeyPrefix!)) return "openai";
    return "gemini"; // Default if no specific prefix matches
  }

  public loadConfig(): Config {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, "utf8");
        const parsedConfig = JSON.parse(configData) as Partial<Config>;

        let provider = parsedConfig.apiProvider;
        if (!provider || !PROVIDER_CONFIGS[provider]) {
          provider = this.defaultConfig.apiProvider;
        }
        
        const loaded: Config = {
          ...this.defaultConfig, // Ensure all keys exist
          ...parsedConfig,       // Override with loaded values
          apiProvider: provider, // Ensure provider is valid
        };

        // Sanitize models based on the final provider
        loaded.extractionModel = this.sanitizeModel(loaded.extractionModel, provider);
        loaded.solutionModel = this.sanitizeModel(loaded.solutionModel, provider);
        loaded.debuggingModel = this.sanitizeModel(loaded.debuggingModel, provider);
        
        return loaded;
      }
      this.saveConfigInternal(this.defaultConfig);
      return { ...this.defaultConfig };
    } catch (err) {
      console.error("Error loading config, returning defaults:", err);
      return { ...this.defaultConfig };
    }
  }

  private saveConfigInternal(config: Config): void {
    try {
      const configDir = path.dirname(this.configPath);
      fs.mkdirSync(configDir, { recursive: true }); // Ensure dir exists
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error("Error saving config:", err);
    }
  }

  public updateConfig(updates: Partial<Config>): Config {
    const currentConfig = this.loadConfig();
    let newConfig = { ...currentConfig, ...updates }; // Apply updates

    let finalProvider = newConfig.apiProvider;

    // 1. Auto-detect provider if API key is updated AND provider was not explicitly part of this update call
    if (updates.apiKey && updates.apiProvider === undefined) {
        finalProvider = this.detectProviderFromApiKey(updates.apiKey);
        newConfig.apiProvider = finalProvider;
    }
    
    // 2. If provider changed (explicitly or by API key detection), reset models to defaults for the new provider,
    //    UNLESS those models were also part of the current `updates` object.
    if (finalProvider !== currentConfig.apiProvider) {
        const providerDefaults = PROVIDER_CONFIGS[finalProvider];
        newConfig.extractionModel = updates.extractionModel ?? providerDefaults.defaultModel;
        newConfig.solutionModel = updates.solutionModel ?? providerDefaults.defaultModel;
        newConfig.debuggingModel = updates.debuggingModel ?? providerDefaults.defaultModel;
    }

    // 3. Sanitize all models based on the final provider
    newConfig.extractionModel = this.sanitizeModel(newConfig.extractionModel, finalProvider);
    newConfig.solutionModel = this.sanitizeModel(newConfig.solutionModel, finalProvider);
    newConfig.debuggingModel = this.sanitizeModel(newConfig.debuggingModel, finalProvider);

    // 4. Validate opacity
    if (newConfig.opacity !== undefined) {
        newConfig.opacity = Math.min(1.0, Math.max(0.1, newConfig.opacity));
    }

    this.saveConfigInternal(newConfig);

    const relevantFields: (keyof Config)[] = ["apiKey", "apiProvider", "extractionModel", "solutionModel", "debuggingModel", "language"];
    if (relevantFields.some(key => currentConfig[key] !== newConfig[key])) {
      this.emit("config-updated", { ...newConfig });
    }
    
    return { ...newConfig };
  }

  public hasApiKey(): boolean {
    return !!this.loadConfig().apiKey?.trim();
  }

  public isValidApiKeyFormat(apiKey: string, provider?: ApiProvider): boolean {
    const effectiveProvider = provider || this.detectProviderFromApiKey(apiKey);
    return PROVIDER_CONFIGS[effectiveProvider].apiKeyValidationRegex.test(apiKey.trim());
  }

  public async testApiKey(apiKey: string, providerInput?: ApiProvider): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey?.trim()) return { valid: false, error: "API key is empty." };

    const provider = providerInput || this.detectProviderFromApiKey(apiKey);
    console.log(`Testing API key for provider: ${provider}`);
    try {
        return await PROVIDER_CONFIGS[provider].testKeyFunction(apiKey);
    } catch (error: any) {
        console.error(`Error during API key test for ${provider}:`, error);
        return { valid: false, error: error.message || `An unexpected error occurred.` };
    }
  }

  public getOpacity(): number { return this.loadConfig().opacity; }
  public setOpacity(opacity: number): void { this.updateConfig({ opacity }); }
  
  public getLanguage(): string { return this.loadConfig().language; }
  public setLanguage(language: string): void { this.updateConfig({ language }); }
}

export const configHelper = new ConfigHelper();