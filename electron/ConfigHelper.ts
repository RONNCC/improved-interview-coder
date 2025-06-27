// ConfigHelper.ts
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { EventEmitter } from "events"
import { OpenAI } from "openai"
import { ApiProvider } from "../src/types/electron"

export interface AppConfig {
  apiKey: string;
  apiProvider: ApiProvider;
  extractionModel: string;
  solutionModel: string;
  debuggingModel: string;
  language: string;
  opacity: number;
}

interface ModelConfig {
  models: string[];
  defaultModel: string;
  keyPrefix: string;
  keyPattern: RegExp;
}

export class ConfigHelper extends EventEmitter {
  private configPath: string;
  
  private readonly defaultConfig: AppConfig = {
    apiKey: "",
    apiProvider: ApiProvider.Gemini,
    extractionModel: "gemini-2.0-flash",
    solutionModel: "gemini-2.0-flash",
    debuggingModel: "gemini-2.0-flash",
    language: "python",
    opacity: 1.0
  };

  private readonly providerConfigs: Record<ApiProvider, ModelConfig> = {
    [ApiProvider.OpenAI]: {
      models: [
        "gpt-4.1",
        "o4-mini",
        "gpt-4o",
        "gpt-3.5-turbo",
        "o3",
        "gpt-4.5-preview-2025-02-27",
        "gpt-4.1-mini"
      ],
      defaultModel: "gpt-4o",
      keyPrefix: "sk-",
      keyPattern: /^sk-[a-zA-Z0-9]{32,}$/
    },
    [ApiProvider.Gemini]: {
      models: [
        "gemini-2.5-pro-preview-05-06",
        "gemini-2.0-flash",
        "gemini-2.5-flash-preview-05-20"
      ],
      defaultModel: "gemini-2.0-flash",
      keyPrefix: "",
      keyPattern: /^[a-zA-Z0-9]{10,}$/
    },
    [ApiProvider.Anthropic]: {
      models: [
        "claude-3-7-sonnet-20250219",
        "claude-3-5-sonnet-20241022",
        "claude-3-opus-20240229"
      ],
      defaultModel: "claude-3-7-sonnet-20250219",
      keyPrefix: "sk-ant-",
      keyPattern: /^sk-ant-[a-zA-Z0-9]{32,}$/
    }
  };

  constructor() {
    super();
    this.configPath = this.getConfigPath();
    this.ensureConfigExists();
  }

  private getConfigPath(): string {
    try {
      return path.join(app.getPath('userData'), 'config.json');
    } catch (err) {
      console.warn('Could not access user data path, using fallback');
      return path.join(process.cwd(), 'config.json');
    }
  }

  private ensureConfigExists(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.saveConfig(this.defaultConfig);
      }
    } catch (err) {
      console.error("Error ensuring config exists:", err);
    }
  }

  private detectProviderFromKey(apiKey: string): ApiProvider {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.startsWith('sk-ant-')) {
      return ApiProvider.Anthropic;
    } else if (trimmedKey.startsWith('sk-')) {
      return ApiProvider.OpenAI;
    }
    return ApiProvider.Gemini;
  }

  private sanitizeModel(model: string, provider: ApiProvider): string {
    const config = this.providerConfigs[provider];
    if (!config.models.includes(model)) {
      console.warn(
        `Invalid ${provider} model specified: ${model}. Using default: ${config.defaultModel}`
      );
      return config.defaultModel;
    }
    return model;
  }

  private validateApiKeyFormat(apiKey: string, provider: ApiProvider): boolean {
    const config = this.providerConfigs[provider];
    return config.keyPattern.test(apiKey.trim());
  }

  private getDefaultModelsForProvider(provider: ApiProvider): {
    extractionModel: string;
    solutionModel: string;
    debuggingModel: string;
  } {
    const defaultModel = this.providerConfigs[provider].defaultModel;
    return {
      extractionModel: defaultModel,
      solutionModel: defaultModel,
      debuggingModel: defaultModel
    };
  }

  public loadConfig(): AppConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.saveConfig(this.defaultConfig);
        return this.defaultConfig;
      }

      const configData = fs.readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Ensure valid provider
      if (!Object.values(ApiProvider).includes(config.apiProvider)) {
        config.apiProvider = ApiProvider.Gemini;
      }
      
      // Sanitize models
      const provider = config.apiProvider as ApiProvider;
      if (config.extractionModel) {
        config.extractionModel = this.sanitizeModel(config.extractionModel, provider);
      }
      if (config.solutionModel) {
        config.solutionModel = this.sanitizeModel(config.solutionModel, provider);
      }
      if (config.debuggingModel) {
        config.debuggingModel = this.sanitizeModel(config.debuggingModel, provider);
      }
      
      return { ...this.defaultConfig, ...config };
    } catch (err) {
      console.error("Error loading config:", err);
      return this.defaultConfig;
    }
  }

  public saveConfig(config: AppConfig): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error("Error saving config:", err);
    }
  }

  public updateConfig(updates: Partial<AppConfig>): AppConfig {
    try {
      const currentConfig = this.loadConfig();
      
      // Auto-detect provider if API key is provided
      if (updates.apiKey && !updates.apiProvider) {
        updates.apiProvider = this.detectProviderFromKey(updates.apiKey);
        console.log(`Auto-detected ${updates.apiProvider} API key format`);
      }
      
      // Reset models if provider is changing
      if (updates.apiProvider && updates.apiProvider !== currentConfig.apiProvider) {
        const defaultModels = this.getDefaultModelsForProvider(updates.apiProvider);
        Object.assign(updates, defaultModels);
      }
      
      // Sanitize models in updates
      const provider = (updates.apiProvider || currentConfig.apiProvider) as ApiProvider;
      ['extractionModel', 'solutionModel', 'debuggingModel'].forEach(modelKey => {
        const key = modelKey as keyof Pick<AppConfig, 'extractionModel' | 'solutionModel' | 'debuggingModel'>;
        if (updates[key]) {
          (updates as any)[key] = this.sanitizeModel(
            updates[key] as string, 
            provider
          );
        }
      });
      
      const newConfig = { ...currentConfig, ...updates };
      this.saveConfig(newConfig);
      
      // Emit update event for non-opacity changes
      const hasNonOpacityChanges = Object.keys(updates).some(key => key !== 'opacity');
      if (hasNonOpacityChanges) {
        this.emit('config-updated', newConfig);
      }
      
      return newConfig;
    } catch (error) {
      console.error('Error updating config:', error);
      return this.defaultConfig;
    }
  }

  public hasApiKey(): boolean {
    const config = this.loadConfig();
    return !!config.apiKey && config.apiKey.trim().length > 0;
  }
  
  public isValidApiKeyFormat(apiKey: string, provider?: ApiProvider): boolean {
    const detectedProvider = provider || this.detectProviderFromKey(apiKey);
    return this.validateApiKeyFormat(apiKey, detectedProvider);
  }
  
  public getOpacity(): number {
    const config = this.loadConfig();
    return config.opacity ?? 1.0;
  }

  public setOpacity(opacity: number): void {
    const clamped = Math.max(0.1, Math.min(1.0, opacity));
    this.updateConfig({ opacity: clamped });
  }

  public getLanguage(): string {
    return this.loadConfig().language || "python";
  }

  public setLanguage(language: string): void {
    this.updateConfig({ language: language.trim() });
  }
  
  public async testApiKey(
    apiKey: string,
    provider?: ApiProvider
  ): Promise<{ valid: boolean; error?: string }> {
    const detectedProvider = provider || this.detectProviderFromKey(apiKey);
    
    if (!this.validateApiKeyFormat(apiKey, detectedProvider)) {
      return { valid: false, error: `Invalid ${detectedProvider} API key format.` };
    }

    switch (detectedProvider) {
      case ApiProvider.OpenAI:
        return this.testOpenAIKey(apiKey);
      case ApiProvider.Gemini:
        return this.testGeminiKey(apiKey);
      case ApiProvider.Anthropic:
        return this.testAnthropicKey(apiKey);
      default:
        return { valid: false, error: "Unknown API provider" };
    }
  }
  
  private async testOpenAIKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      const openai = new OpenAI({ apiKey });
      await openai.models.list();
      return { valid: true };
    } catch (error: any) {
      console.error('OpenAI API key test failed:', error);
      
      const errorMessages: Record<number, string> = {
        401: 'Invalid API key. Please check your OpenAI key and try again.',
        429: 'Rate limit exceeded. Your OpenAI API key has reached its request limit or has insufficient quota.',
        500: 'OpenAI server error. Please try again later.'
      };
      
      const errorMessage = errorMessages[error.status] || 
        (error.message ? `Error: ${error.message}` : 'Unknown error validating OpenAI API key');
      
      return { valid: false, error: errorMessage };
    }
  }
  
  private async testGeminiKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      // TODO: Implement actual Gemini API validation
      if (apiKey && apiKey.trim().length >= 20) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid Gemini API key format.' };
    } catch (error: any) {
      console.error('Gemini API key test failed:', error);
      return { 
        valid: false, 
        error: error.message ? `Error: ${error.message}` : 'Unknown error validating Gemini API key' 
      };
    }
  }

  private async testAnthropicKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      // TODO: Implement actual Anthropic API validation
      if (this.validateApiKeyFormat(apiKey, ApiProvider.Anthropic)) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid Anthropic API key format.' };
    } catch (error: any) {
      console.error('Anthropic API key test failed:', error);
      return { 
        valid: false, 
        error: error.message ? `Error: ${error.message}` : 'Unknown error validating Anthropic API key' 
      };
    }
  }
}

// Export a singleton instance
export const configHelper = new ConfigHelper();