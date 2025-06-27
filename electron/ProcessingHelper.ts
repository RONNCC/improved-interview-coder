// ProcessingHelper.ts
import fs from "node:fs"
import { BrowserWindow } from "electron"
import axios from "axios"
import { createAiProvider } from "./ai-providers/AiProviderFactory"
import { configHelper } from "./ConfigHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IAiProvider, ApiKeyError, Solution, DebugResult } from "./ai-providers/IAiProvider"
import { IProcessingHelperDeps } from "./main"

// API Configuration
export const API_CONFIG = {
  maxTokens: {
    extraction: 6000,
    solution: 6000,
    debugging: 8000
  }
} as const;

// Enum for API providers
export enum ApiProvider {
  OpenAI = "openai",
  Gemini = "gemini",
  Anthropic = "anthropic"
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private aiProvider: IAiProvider | null = null;

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    
    this._initializeAiProvider();
    
    configHelper.on('config-updated', () => {
      this._initializeAiProvider();
    });
  }
  
  private _initializeAiProvider(): void {
    const config = configHelper.loadConfig();
    this.aiProvider = createAiProvider(config);
    if (this.aiProvider) {
        console.log(`${config.apiProvider} provider initialized successfully.`);
    }
  }

  /**
   * Ensures that the currently configured AI provider is initialized and valid.
   * If not initialized, it attempts to reinitialize it.
   * Sends an API_KEY_INVALID event to the main window if initialization fails.
   * @returns {boolean} True if the AI provider is successfully initialized and valid, false otherwise.
   */
  private _ensureAiProviderIsValid(): boolean {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) {
      console.error("Main window not available for AI provider validation.");
      return false;
    }

    if (!this.aiProvider) {
      this._initializeAiProvider();
    }

    if (!this.aiProvider) {
      const config = configHelper.loadConfig();
      console.error(`${config.apiProvider} provider not initialized or API key invalid.`);
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return false;
    }
    return true;
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getLanguage(): Promise<string> {
    const DEFAULT_LANGUAGE = "python";

    try {
      // Priority 1: Get from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }
      
      // Priority 2: Get from window variable
      const mainWindow = this.deps.getMainWindow();
      if (mainWindow) {
        await this.waitForInitialization(mainWindow);
        const language = await mainWindow.webContents.executeJavaScript(
          "window.__LANGUAGE__"
        );
        
        if (typeof language === "string" && language) {
          return language;
        }
      }
    } catch (error) {
      // Any error in the above process (config load, JS execution) will be caught here.
      console.warn("Could not determine language, falling back to default.", error);
    }
    
    // Priority 3: Return the default if all else fails
    return DEFAULT_LANGUAGE;
  }

  public async processScreenshots(additionalText?: string): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    // Ensure the AI provider is initialized and valid before proceeding
    if (!this._ensureAiProviderIsValid()) {
      return; // Exit if client is not valid (error message already sent)
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)
      
      // Check if the queue is empty
      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal, additionalText)

        if (!result.success) {
          console.error("Processing failed:", result.error)
          if (result.isApiKeyError) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        // Check for user-initiated aborts from any SDK
        if (axios.isCancel(error) || error?.name === 'APIUserAbortError') {
          console.log("Initial processing was canceled by the user.");
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "An unexpected error occurred during processing."
          )
          console.error("Processing error:", error)
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)
      
      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        
        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];
        
        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }
              
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )
        
        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }
        
        console.log(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          validScreenshots,
          signal,
          additionalText
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          if (result.isApiKeyError) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
              result.error
            )
          }
        }
      } catch (error: any) {
        // Check for user-initiated aborts from any SDK
        if (axios.isCancel(error) || error?.name === 'APIUserAbortError') {
          console.log("Debug processing was canceled by the user.");
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message || "An unexpected error occurred during debugging."
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal?: AbortSignal,
    additionalText?: string
  ): Promise<{ success: boolean; data?: Solution; error?: string; isApiKeyError?: boolean }> {
    try {
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      if (!this.aiProvider) {
        return { success: false, error: "AI Provider not initialized." };
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }
      const imageDataList = screenshots.map(s => ({ data: s.data }));
      const problemInfo = await this.aiProvider.extractProblemInfo(imageDataList, language, signal);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Problem analyzed successfully. Preparing to generate solution...",
          progress: 40
        });
      }

      this.deps.setProblemInfo(problemInfo);

      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        const solutionsResult = await this.generateSolutionsHelper(signal, additionalText)
        if (solutionsResult.success) {
          this.screenshotHelper.clearExtraScreenshotQueue()
          mainWindow.webContents.send("processing-status", {
            message: "Solution generated successfully",
            progress: 100
          })
          return {
            success: true,
            data: solutionsResult.data
          }
        } else {
          // Propagate error information from the helper
          return { success: false, ...solutionsResult }
        }
      }

      return { success: false, error: "Main window not available" };
    } catch (error: unknown) {
      if (axios.isCancel(error)) {
        return { success: false, error: "Processing was canceled by the user." };
      }

      console.error("Error in processScreenshotsHelper:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to process screenshots. Please try again.";
      return {
        success: false,
        error: errorMessage,
        isApiKeyError: error instanceof ApiKeyError,
      };
    }
  }

  private async generateSolutionsHelper(
    signal?: AbortSignal,
    additionalText?: string
  ): Promise<{ success: boolean; data?: Solution; error?: string; isApiKeyError?: boolean }> {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      if (!this.aiProvider) {
        return { success: false, error: "AI Provider not initialized." };
      }

      if (!problemInfo || !problemInfo.problem_statement) {
        console.error("No problem statement available for solution generation.", problemInfo);
        return {
          success: false,
          error: "Problem statement extraction failed. Please try again with clearer screenshots."
        };
      }

      console.log("Problem info before solution generation:", problemInfo);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }
      
      const solution = await this.aiProvider.generateSolution(
        problemInfo,
        language,
        signal,
        additionalText
      );

      console.log("Formatted Solution Response:", solution);

      return {
        success: true,
        data: solution
      };
    } catch (error: unknown) {
      let errorMsg = "Failed to generate solution"
      let isApiKeyError = false

      if (axios.isCancel(error)) {
        errorMsg = "Processing was canceled by the user."
      } else if (error instanceof ApiKeyError) {
        errorMsg = error.message
        isApiKeyError = true
      } else if (error instanceof Error && error.message) {
        errorMsg = error.message
      }
      console.error("Solution generation error:", error)
      return {
        success: false,
        error: errorMsg,
        isApiKeyError: isApiKeyError
      }
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal?: AbortSignal,
    additionalText?: string
  ): Promise<{ success: boolean; data?: DebugResult; error?: string; isApiKeyError?: boolean }> {
    console.log("processExtraScreenshotsHelper received additionalText:", additionalText);
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }
      if (!this.aiProvider) {
        return { success: false, error: "AI Provider not initialized." };
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }
      
      const imageDataList = screenshots.map(s => ({ data: s.data }));
      const debugResult = await this.aiProvider.debugSolution(
        problemInfo,
        imageDataList,
        language,
        signal,
        additionalText
      );

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      return {
        success: true,
        data: debugResult
      };
    } catch (error: unknown) {
      console.error("Debug processing error:", error)
      let errorMsg = "Failed to process debug request"
      let isApiKeyError = false
      if (axios.isCancel(error)) {
        errorMsg = "Processing was canceled by the user."
      } else if (error instanceof ApiKeyError) {
        errorMsg = error.message
        isApiKeyError = true
      } else if (error instanceof Error) {
        errorMsg = error.message || "Failed to process debug request"
      }
      return {
        success: false,
        error: errorMsg,
        isApiKeyError: isApiKeyError
      }
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}
