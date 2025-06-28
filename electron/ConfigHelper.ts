// ConfigHelper.ts
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { EventEmitter } from "events"
import { OpenAI } from "openai"
import { PROVIDER_BACKEND_CONFIGS, ElectronApiProvider } from './providers'

export interface AppConfig {
  apiKeys: Record<ElectronApiProvider, string>;
  apiProvider: ElectronApiProvider;
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
  displayName: string;
  description: string;
}

export class ConfigHelper extends EventEmitter {
  private configPath: string;
  
  // Use centralized provider registry
  private readonly providerRegistry: Record<ElectronApiProvider, ModelConfig> = PROVIDER_BACKEND_CONFIGS;

  private readonly defaultConfig: AppConfig = {
    apiKeys: this.createEmptyApiKeys(),
    apiProvider: ElectronApiProvider.Gemini,
    extractionModel: "gemini-2.0-flash",
    solutionModel: "gemini-2.0-flash",
    debuggingModel: "gemini-2.0-flash",
    language: "python",
    opacity: 1.0
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

  private detectProviderFromKey(apiKey: string): ElectronApiProvider {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.startsWith('sk-ant-')) {
      return ElectronApiProvider.Anthropic;
    } else if (trimmedKey.startsWith('sk-')) {
      return ElectronApiProvider.OpenAI;
    }
    return ElectronApiProvider.Gemini;
  }

  private sanitizeModel(model: string, provider: ElectronApiProvider): string {
    const config = this.providerRegistry[provider];
    if (!config.models.includes(model)) {
      console.warn(
        `Invalid ${provider} model specified: ${model}. Using default: ${config.defaultModel}`
      );
      return config.defaultModel;
    }
    return model;
  }

  private validateApiKeyFormat(apiKey: string, provider: ElectronApiProvider): boolean {
    const config = this.providerRegistry[provider];
    return config.keyPattern.test(apiKey.trim());
  }

  private getDefaultModelsForProvider(provider: ElectronApiProvider): {
    extractionModel: string;
    solutionModel: string;
    debuggingModel: string;
  } {
    const defaultModel = this.providerRegistry[provider].defaultModel;
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
      
      // Migrate old config format if needed
      const migratedConfig = this.migrateConfigIfNeeded(config);
      
      // Ensure valid provider
      if (!Object.values(ElectronApiProvider).includes(migratedConfig.apiProvider)) {
        migratedConfig.apiProvider = ElectronApiProvider.Gemini;
      }
      
      // Sanitize models
      const provider = migratedConfig.apiProvider as ElectronApiProvider;
      if (migratedConfig.extractionModel) {
        migratedConfig.extractionModel = this.sanitizeModel(migratedConfig.extractionModel, provider);
      }
      if (migratedConfig.solutionModel) {
        migratedConfig.solutionModel = this.sanitizeModel(migratedConfig.solutionModel, provider);
      }
      if (migratedConfig.debuggingModel) {
        migratedConfig.debuggingModel = this.sanitizeModel(migratedConfig.debuggingModel, provider);
      }
      
      return { ...this.defaultConfig, ...migratedConfig };
    } catch (err) {
      console.error("Error loading config:", err);
      return this.defaultConfig;
    }
  }

  /**
   * Migrate old config format to new format
   */
  private migrateConfigIfNeeded(config: any): any {
    // Check if this is an old config format (has apiKey instead of apiKeys)
    if (config.apiKey && !config.apiKeys) {
      console.log("Migrating config from old format to new format");
      
      const oldApiKey = config.apiKey;
      const oldProvider = (config.apiProvider || ElectronApiProvider.Gemini) as ElectronApiProvider;
      
      // Create new apiKeys structure with all registered providers
      const newApiKeys = this.createEmptyApiKeys();
      
      // Move the old API key to the appropriate provider
      if (oldApiKey && oldApiKey.trim().length > 0) {
        newApiKeys[oldProvider] = oldApiKey;
      }
      
      // Create new config structure
      const newConfig = {
        ...config,
        apiKeys: newApiKeys
      };
      
      // Remove old apiKey field
      delete newConfig.apiKey;
      
      // Save the migrated config
      this.saveConfig(newConfig);
      
      return newConfig;
    }
    
    return config;
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
      
      // Handle API key updates for specific providers
      if (updates.apiKeys) {
        // Merge with existing API keys
        updates.apiKeys = { ...currentConfig.apiKeys, ...updates.apiKeys };
      }
      
      // Reset models if provider is changing
      if (updates.apiProvider && updates.apiProvider !== currentConfig.apiProvider) {
        const defaultModels = this.getDefaultModelsForProvider(updates.apiProvider);
        Object.assign(updates, defaultModels);
      }
      
      // Sanitize models in updates
      const provider = (updates.apiProvider || currentConfig.apiProvider) as ElectronApiProvider;
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

  /**
   * Get API key for a specific provider
   */
  public getApiKey(provider: ElectronApiProvider): string {
    const config = this.loadConfig();
    return config.apiKeys[provider] || "";
  }

  /**
   * Set API key for a specific provider
   */
  public setApiKey(provider: ElectronApiProvider, apiKey: string): void {
    const currentConfig = this.loadConfig();
    const updatedApiKeys = { ...currentConfig.apiKeys, [provider]: apiKey };
    this.updateConfig({ apiKeys: updatedApiKeys });
  }

  /**
   * Check if API key exists for the current provider
   */
  public hasApiKey(): boolean {
    const config = this.loadConfig();
    return !!config.apiKeys[config.apiProvider] && config.apiKeys[config.apiProvider].trim().length > 0;
  }

  /**
   * Check if API key exists for a specific provider
   */
  public hasApiKeyForProvider(provider: ElectronApiProvider): boolean {
    const config = this.loadConfig();
    return !!config.apiKeys[provider] && config.apiKeys[provider].trim().length > 0;
  }
  
  public isValidApiKeyFormat(apiKey: string, provider?: ElectronApiProvider): boolean {
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
    provider?: ElectronApiProvider
  ): Promise<{ valid: boolean; error?: string }> {
    const detectedProvider = provider || this.detectProviderFromKey(apiKey);
    
    if (!this.validateApiKeyFormat(apiKey, detectedProvider)) {
      return { valid: false, error: `Invalid ${detectedProvider} API key format.` };
    }

    switch (detectedProvider) {
      case ElectronApiProvider.OpenAI:
        return this.testOpenAIKey(apiKey);
      case ElectronApiProvider.Gemini:
        return this.testGeminiKey(apiKey);
      case ElectronApiProvider.Anthropic:
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
      if (this.validateApiKeyFormat(apiKey, ElectronApiProvider.Anthropic)) {
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

  /**
   * Create empty API keys object for all registered providers
   */
  private createEmptyApiKeys(): Record<ElectronApiProvider, string> {
    const apiKeys: Record<string, string> = {};
    Object.keys(this.providerRegistry).forEach(provider => {
      apiKeys[provider] = "";
    });
    return apiKeys as Record<ElectronApiProvider, string>;
  }

  /**
   * Get all registered providers
   */
  public getRegisteredProviders(): ElectronApiProvider[] {
    return Object.keys(this.providerRegistry) as ElectronApiProvider[];
  }

  /**
   * Get provider configuration
   */
  public getProviderConfig(provider: ElectronApiProvider): ModelConfig | undefined {
    return this.providerRegistry[provider];
  }

  /**
   * Get all provider configurations
   */
  public getAllProviderConfigs(): Record<ElectronApiProvider, ModelConfig> {
    return this.providerRegistry as Record<ElectronApiProvider, ModelConfig>;
  }

  /**
   * Register a new provider (for future extensibility)
   */
  public registerProvider(provider: ElectronApiProvider, config: ModelConfig): void {
    this.providerRegistry[provider] = config;
    // Update default config to include new provider
    this.defaultConfig.apiKeys[provider] = "";
  }
}

// Export a singleton instance
export const configHelper = new ConfigHelper();