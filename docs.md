# Adding New AI Providers

1. **Add to Enum**
   **File:** `src/types/electron.d.ts`
   ```typescript
   export enum ApiProvider {
     OpenAI = "openai",
     Gemini = "gemini", 
     Anthropic = "anthropic",
     Cohere = "cohere"  // ← Add here
   }
   ```

2. **Add Configuration**
   **File:** `src/config/providers.ts`
   ```typescript
   // UI Config
   [ApiProvider.Cohere]: {
     displayName: "Cohere",
     description: "Command models",
     placeholder: "cohere-...",
     helpText: "Your API key is stored locally and never sent to any server except Cohere",
     setupSteps: [
       "1. Create an account at ",
       "2. Add payment method to your account", 
       "3. Create a new API key and paste it here"
     ],
     setupUrl: "https://console.cohere.ai/",
     defaultModels: {
       extractionModel: "command",
       solutionModel: "command",
       debuggingModel: "command"
     }
   },

   // Backend Config
   [ApiProvider.Cohere]: {
     models: ["command", "command-light", "command-nightly"],
     defaultModel: "command",
     keyPrefix: "cohere-",
     keyPattern: /^cohere-[a-zA-Z0-9]{32,}$/,
     displayName: "Cohere",
     description: "Command models"
   }
   ```

3. **Create Provider Class**
   **File:** `electron/ai-providers/CohereProvider.ts`
   ```typescript
   import { IAiProvider, ProblemInfo, Solution, DebugResult } from "./IAiProvider";
   import { AppConfig } from "../ConfigHelper";

   export class CohereProvider implements IAiProvider {
     constructor(private client: any, private config: AppConfig) {}

     async extractProblemInfo(screenshots: Array<{ data: string }>, language: string, signal?: AbortSignal): Promise<ProblemInfo> {
       // Implementation
     }

     async generateSolution(problemInfo: ProblemInfo, language: string, signal?: AbortSignal, additionalText?: string): Promise<Solution> {
       // Implementation
     }

     async debugSolution(problemInfo: ProblemInfo, screenshots: Array<{ data: string }>, language: string, signal?: AbortSignal, additionalText?: string): Promise<DebugResult> {
       // Implementation
     }
   }
   ```

4. **Add to Factory**
   **File:** `electron/ai-providers/AiProviderFactory.ts`
   ```typescript
   import { CohereProvider } from "./CohereProvider";
   import { CohereClient } from "cohere-ai";

   const providerFactories: Record<ApiProvider, ProviderFactory> = {
     // ... existing providers ...
     [ApiProvider.Cohere]: {
       createClient: (apiKey: string) => new CohereClient({ apiKey }),
       createProvider: (client: CohereClient, config: AppConfig) => new CohereProvider(client, config)
     }
   };
   ```

5. **Install Dependencies**
   ```bash
   npm install cohere-ai
   ```