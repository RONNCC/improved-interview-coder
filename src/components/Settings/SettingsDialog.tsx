import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";
import { ApiProvider } from "../../types";
import { PROVIDER_CONFIGS } from "../../config/providers";

type AIModel = {
  id: string;
  name: string;
  description: string;
};

type ModelCategory = {
  key: 'extractionModel' | 'solutionModel' | 'debuggingModel';
  title: string;
  description: string;
  openaiModels: AIModel[];
  geminiModels: AIModel[];
  anthropicModels: AIModel[];
};

// Define available models for each category
const modelCategories: ModelCategory[] = [
  {
    key: 'extractionModel',
    title: 'Problem Extraction',
    description: 'Model used to analyze screenshots and extract problem details',
    openaiModels: [
      {
        id: "gpt-4.1",
        name: "gpt-4.1",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        description: "Faster, more cost-effective option"
      },
      {
        id: "gpt-4.1-mini",
        name: "gpt-4.1-mini",
        description: "Faster, more cost-effective option"
      },
      {
        id: "gpt-4o-2024-11-20",
        name: "gpt-4o-2024-11-20",
        description: "Best overall performance for problem extraction"
      }
    ],
    geminiModels: [
      {
        id: "gemini-2.5-flash-preview-05-20",
        name: "gemini-2.5-flash-preview-05-20",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "gemini-2.0-flash",
        name: "gemini-2.0-flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  },
  {
    key: 'solutionModel',
    title: 'Solution Generation',
    description: 'Model used to generate coding solutions',
    openaiModels: [
      {
        id: "gpt-4.1",
        name: "gpt-4.1",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        description: "Faster, more cost-effective option"
      },
      {
        id: "gpt-4.5-preview-2025-02-27",
        name: "gpt-4.5-preview-2025-02-27",
        description: "Prototype"
      }
    ],
    geminiModels: [
      {
        id: "gemini-2.5-pro-preview-05-06",
        name: "gemini-2.5-pro-preview-05-06",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "gemini-2.5-flash-preview-05-20",
        name: "gemini-2.5-flash-preview-05-20	",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  },
  {
    key: 'debuggingModel',
    title: 'Debugging',
    description: 'Model used to debug and improve solutions',
    openaiModels: [
      {
        id: "gpt-4.1",
        name: "gpt-4.1",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        description: "reasoning model"
      }
    ],
    geminiModels: [
      {
        id: "gemini-2.5-pro-preview-05-06",
        name: "gemini-2.5-pro-preview-05-06",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "gemini-2.5-flash-preview-05-20",
        name: "gemini-2.5-flash-preview-05-20",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  }
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKeys, setApiKeys] = useState<Record<ApiProvider, string>>({
    [ApiProvider.OpenAI]: "",
    [ApiProvider.Gemini]: "",
    [ApiProvider.Anthropic]: ""
  });
  const [apiProvider, setApiProvider] = useState<ApiProvider>(ApiProvider.OpenAI);
  const [extractionModel, setExtractionModel] = useState("gpt-4o");
  const [solutionModel, setSolutionModel] = useState("gpt-4o");
  const [debuggingModel, setDebuggingModel] = useState("gpt-4o");
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const { showToast } = useToast();

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    // Only call onOpenChange when there's actually a change
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  };
  
  // Load current config on dialog open
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        apiKeys?: Record<ApiProvider, string>;
        apiProvider?: ApiProvider;
        extractionModel?: string;
        solutionModel?: string;
        debuggingModel?: string;
      }

      window.electronAPI
        .getConfig()
        .then((config: Config) => {
          setApiKeys(config.apiKeys || {
            [ApiProvider.OpenAI]: "",
            [ApiProvider.Gemini]: "",
            [ApiProvider.Anthropic]: ""
          });
          setApiProvider(config.apiProvider || ApiProvider.OpenAI);
          setExtractionModel(config.extractionModel || "gpt-4o");
          setSolutionModel(config.solutionModel || "gpt-4o");
          setDebuggingModel(config.debuggingModel || "gpt-4o");
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load current settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, showToast]);

  // Handle API provider change
  const handleProviderChange = (provider: ApiProvider) => {
    setApiProvider(provider);
    // Reset models to correct defaults when changing provider
    const providerConfig = PROVIDER_CONFIGS[provider];
    if (providerConfig) {
      setExtractionModel(providerConfig.defaultModels.extractionModel);
      setSolutionModel(providerConfig.defaultModels.solutionModel);
      setDebuggingModel(providerConfig.defaultModels.debuggingModel);
    }
  };

  // Handle API key change for current provider
  const handleApiKeyChange = (apiKey: string) => {
    setApiKeys(prev => ({
      ...prev,
      [apiProvider]: apiKey
    }));
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKeys,
        apiProvider,
        extractionModel,
        solutionModel,
        debuggingModel,
      });
      
      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);
        
        // Force reload the app to apply the API key
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  // Open external link handler
  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  // Get current provider config
  const currentProviderConfig = PROVIDER_CONFIGS[apiProvider];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(450px, 90vw)',
          height: 'auto',
          minHeight: '400px',
          maxHeight: '90vh',
          overflowY: 'auto',
          zIndex: 9999,
          margin: 0,
          padding: '20px',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          animation: 'fadeIn 0.25s ease forwards',
          opacity: 0.98
        }}
      >        
        <DialogHeader>
          <DialogTitle>API Settings</DialogTitle>
          <DialogDescription className="text-white/70">
            Configure your API key and model preferences. You'll need your own API key to use this application.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* API Provider Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">API Provider</label>
            <div className="flex gap-2">
              {Object.entries(PROVIDER_CONFIGS).map(([providerKey, config]) => {
                const provider = providerKey as ApiProvider;
                const isSelected = apiProvider === provider;
                const hasApiKey = apiKeys[provider] && apiKeys[provider].trim().length > 0;
                
                return (
                  <div
                    key={provider}
                    className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-white/10 border border-white/20"
                        : "bg-black/30 border border-white/5 hover:bg-white/5"
                    }`}
                    onClick={() => handleProviderChange(provider)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          isSelected ? "bg-white" : "bg-white/20"
                        }`}
                      />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-white text-sm">{config.displayName}</p>
                          {hasApiKey && (
                            <div className="w-2 h-2 bg-green-500 rounded-full" title="API key configured" />
                          )}
                        </div>
                        <p className="text-xs text-white/60">{config.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-white" htmlFor="apiKey">
              {currentProviderConfig.displayName} API Key
            </label>
            <Input
              id="apiKey"
              type="password"
              value={apiKeys[apiProvider]}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder={currentProviderConfig.placeholder}
              className="bg-black/50 border-white/10 text-white"
            />
            {apiKeys[apiProvider] && (
              <p className="text-xs text-white/50">
                Current: {maskApiKey(apiKeys[apiProvider])}
              </p>
            )}
            <p className="text-xs text-white/50">
              {currentProviderConfig.helpText}
            </p>
            <div className="mt-2 p-2 rounded-md bg-white/5 border border-white/10">
              <p className="text-xs text-white/80 mb-1">Don't have an API key?</p>
              <p className="text-xs text-white/60 mb-1">
                {currentProviderConfig.setupSteps[0]}
                <button 
                  onClick={() => openExternalLink(currentProviderConfig.setupUrl)} 
                  className="text-blue-400 hover:underline cursor-pointer"
                >
                  {currentProviderConfig.displayName}
                </button>
              </p>
              <p className="text-xs text-white/60 mb-1">{currentProviderConfig.setupSteps[1]}</p>
              <p className="text-xs text-white/60">{currentProviderConfig.setupSteps[2]}</p>
            </div>
          </div>
          
          <div className="space-y-2 mt-4">
            <label className="text-sm font-medium text-white mb-2 block">Keyboard Shortcuts</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-white/70">Toggle Visibility</div>
                <div className="text-white/90 font-mono">Ctrl+B / Cmd+B</div>
                
                <div className="text-white/70">Take Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+H / Cmd+H</div>
                
                <div className="text-white/70">Process Screenshots</div>
                <div className="text-white/90 font-mono">Ctrl+Shift+Enter / Cmd+Shift+Enter</div>
                
                <div className="text-white/70">Delete Last Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+L / Cmd+L</div>
                
                <div className="text-white/70">Reset View</div>
                <div className="text-white/90 font-mono">Ctrl+R / Cmd+R</div>
                
                <div className="text-white/70">Quit Application</div>
                <div className="text-white/90 font-mono">Ctrl+Q / Cmd+Q</div>
                
                <div className="text-white/70">Move Window</div>
                <div className="text-white/90 font-mono">Ctrl+Arrow Keys</div>
                
                <div className="text-white/70">Center Window</div>
                <div className="text-white/90 font-mono">Ctrl+/ / Cmd+/</div>
                
                <div className="text-white/70">Decrease Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+[ / Cmd+[</div>
                
                <div className="text-white/70">Increase Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+] / Cmd+]</div>
                
                <div className="text-white/70">Zoom Out</div>
                <div className="text-white/90 font-mono">Ctrl+- / Cmd+-</div>
                
                <div className="text-white/70">Reset Zoom</div>
                <div className="text-white/90 font-mono">Ctrl+0 / Cmd+0</div>
                
                <div className="text-white/70">Zoom In</div>
                <div className="text-white/90 font-mono">Ctrl+= / Cmd+=</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-4 mt-4">
            <label className="text-sm font-medium text-white">AI Model Selection</label>
            <p className="text-xs text-white/60 -mt-3 mb-2">
              Select which models to use for each stage of the process
            </p>
            
            {modelCategories.map((category) => {
              // Get the appropriate model list based on selected provider
              const models = 
                apiProvider === ApiProvider.OpenAI ? category.openaiModels : 
                apiProvider === ApiProvider.Gemini ? category.geminiModels :
                category.anthropicModels;
              
              return (
                <div key={category.key} className="mb-4">
                  <label className="text-sm font-medium text-white mb-1 block">
                    {category.title}
                  </label>
                  <p className="text-xs text-white/60 mb-2">{category.description}</p>
                  
                  <div className="space-y-2">
                    {models.map((m) => {
                      // Determine which state to use based on category key
                      const currentValue = 
                        category.key === 'extractionModel' ? extractionModel :
                        category.key === 'solutionModel' ? solutionModel :
                        debuggingModel;
                      
                      // Determine which setter function to use
                      const setValue = 
                        category.key === 'extractionModel' ? setExtractionModel :
                        category.key === 'solutionModel' ? setSolutionModel :
                        setDebuggingModel;
                        
                      return (
                        <div
                          key={m.id}
                          className={`p-2 rounded-lg cursor-pointer transition-colors ${
                            currentValue === m.id
                              ? "bg-white/10 border border-white/20"
                              : "bg-black/30 border border-white/5 hover:bg-white/5"
                          }`}
                          onClick={() => setValue(m.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-3 h-3 rounded-full ${
                                currentValue === m.id ? "bg-white" : "bg-white/20"
                              }`}
                            />
                            <div>
                              <p className="font-medium text-white text-xs">{m.name}</p>
                              <p className="text-xs text-white/60">{m.description}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-white/10 hover:bg-white/5 text-white"
          >
            Cancel
          </Button>
          <Button
            className="px-4 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors"
            onClick={handleSave}
            disabled={isLoading || !apiKeys[apiProvider]}
          >
            {isLoading ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
