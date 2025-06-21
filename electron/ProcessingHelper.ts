// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { OpenAI } from "openai"
import { configHelper } from "./ConfigHelper"
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from "@google/genai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

// API Configuration
const API_CONFIG = {
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

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}
export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private openaiClient: OpenAI | null = null
  private geminiClient: GoogleGenAI | null = null
  private anthropicClient: Anthropic | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    
    // Initialize AI client based on config
    this.initializeAIClient();
    
    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }
  
  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();
      
      if (config.apiProvider === ApiProvider.OpenAI) {
        if (config.apiKey) {
          this.openaiClient = new OpenAI({ 
            apiKey: config.apiKey,
            timeout: 60000, // 60 second timeout
            maxRetries: 2   // Retry up to 2 times
          });
          this.geminiClient = null;
          this.anthropicClient = null;
          console.log("OpenAI client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiClient = null;
          this.anthropicClient = null;
          console.warn("No API key available, OpenAI client not initialized");
        }
      } else if (config.apiProvider === ApiProvider.Gemini){
        // Gemini client initialization
        this.openaiClient = null;
        this.anthropicClient = null;
        if (config.apiKey) {
          this.geminiClient = new GoogleGenAI({ apiKey: config.apiKey });
          console.log("Gemini client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiClient = null;
          this.anthropicClient = null;
          console.warn("No API key available, Gemini client not initialized");
        }
      } else if (config.apiProvider === ApiProvider.Anthropic) {
        // Reset other clients
        this.openaiClient = null;
        this.geminiClient = null;
        if (config.apiKey) {
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("Anthropic client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiClient = null;
          this.anthropicClient = null;
          console.warn("No API key available, Anthropic client not initialized");
        }
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      this.openaiClient = null;
      this.geminiClient = null;
      this.anthropicClient = null;
    }
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

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999 // Unlimited credits in this version

    try {
      await this.waitForInitialization(mainWindow)
      return 999 // Always return sufficient credits to work
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999 // Unlimited credits as fallback
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }
      
      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      
      // Default fallback
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();
    
    // First verify we have a valid AI client
    if (config.apiProvider === ApiProvider.OpenAI && !this.openaiClient) {
      this.initializeAIClient();
      
      if (!this.openaiClient) {
        console.error("OpenAI client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === ApiProvider.Gemini && !this.geminiClient) {
      this.initializeAIClient();
      
      if (!this.geminiClient) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === ApiProvider.Anthropic && !this.anthropicClient) {
      // Add check for Anthropic client
      this.initializeAIClient();
      
      if (!this.anthropicClient) {
        console.error("Anthropic client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
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

        const result = await this.processScreenshotsHelper(validScreenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || result.error?.includes("Gemini")) {
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
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
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
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      // --- PROMPT STRINGS EXTRACTED TO TOP, USING language VAR ---
      const openAIPromptSystem =
        "You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information including examples and any classes already given. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text. Also try to roughly return if there is any initial starting code. ";
      const openAIPromptUser =
        `Extract the coding problem details from these screenshots verbosely. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.`;

      const geminiPrompt =
        `You are a coding challenge interpreter. Analyze the screenshots of the coding problem and extract all relevant information including examples and any classes already given. Return the information in JSON format with these fields: problem_statement (ideally verbatim of the objective/input/problem statement), constraints (including any classes already given), example_inputs, example_outputs. Just return the structured JSON without any other text. Preferred coding language we gonna use for this problem is ${language}.`;

      const anthropicPrompt =
        `Extract the coding problem details from these screenshots. Return in JSON format with these fields: problem_statement, constraints, example_input, example_output. Preferred coding language is ${language}.`;
      // ---------------------------------------

      // Step 1: Extract problem info using AI Vision API (OpenAI or Gemini)
      const imageDataList = screenshots.map(screenshot => screenshot.data);

      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }

      let problemInfo;

      if (config.apiProvider === ApiProvider.OpenAI) {
        // Verify OpenAI client
        if (!this.openaiClient) {
          this.initializeAIClient(); // Try to reinitialize

          if (!this.openaiClient) {
            return {
              success: false,
              error: "OpenAI API key not configured or invalid. Please check your settings."
            };
          }
        }

        // Use OpenAI for processing
        const messages = [
          {
            role: "system" as const,
            content: openAIPromptSystem
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: openAIPromptUser
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        // Define the expected structure for the coding problem extraction
        const ProblemExtraction = z.object({
          problem_statement: z.string(),
          constraints: z.string().optional(),
          example_input: z.string().optional(),
          example_output: z.string().optional(),
        });

        // Use OpenAI's beta structured output with zodResponseFormat
        // (Assumes openai.beta.chat.completions.parse and zodResponseFormat are available in your OpenAI SDK)
        let extractionResponse;
        try {
          extractionResponse = await this.openaiClient.beta.chat.completions.parse({
            model: config.extractionModel || "gpt-4o",
            messages: messages,
            response_format: zodResponseFormat(
              ProblemExtraction,
              "problem_extraction"
            ),
            max_completion_tokens: API_CONFIG.maxTokens.extraction,
          });
        } catch (error) {
          console.error("Error during OpenAI structured extraction:", error);
          return {
            success: false,
            error: "Failed to extract problem information in structured format. Please try again or use clearer screenshots."
          };
        }

        console.log("Extraction response from LLM:", extractionResponse);

        // extractionResponse will be the parsed object if successful
        try {
          problemInfo = extractionResponse.choices[0].message.parsed;
        } catch (error) {
          console.error("Error parsing OpenAI structured response:", error);
          return {
            success: false,
            error: "Failed to parse problem information. Please try again or use clearer screenshots."
          };
        }
      } else if (config.apiProvider === ApiProvider.Gemini)  {

          // Use Gemini API with GoogleGenAI SDK
          if (!this.geminiClient) {
            return {
              success: false,
              error: "Gemini API client not initialized. Please check your settings."
            };
          }

          try {
            // Prepare the content parts: text prompt + images as inlineData
            const contentParts = [
              {
                text: geminiPrompt // Assuming geminiPrompt is defined elsewhere
              },
              ...imageDataList.map(data => ({ // Assuming imageDataList is an array of base64 strings
                inlineData: {
                  mimeType: "image/png", // Ensure this matches the actual image type
                  data: data
                }
              }))
            ];
        
            const genAIResult = await this.geminiClient.models.generateContent({
              model: config.extractionModel || "gemini-2.0-flash", // Updated model name
              contents: contentParts, // Simplified - no need for role/parts wrapper
              config: {
                temperature: 0.2,
                responseMimeType: "application/json", // Crucial for JSON mode
                maxOutputTokens: API_CONFIG.maxTokens.extraction,
                responseSchema: { // Defines the expected JSON structure
                  type: "object",
                  properties: {
                    problem_statement: { type: "string", description: "The full problem description." },
                    constraints: { type: "string", description: "Constraints for the problem." },
                    example_input: { type: "string", description: "An example input." },
                    example_output: { type: "string", description: "The corresponding example output." }
                  },
                  required: ["problem_statement"]
                }
              }
            });
          
            // Use the simplified response.text accessor from the new SDK
            const jsonString = genAIResult.text;
          
            if (!jsonString || jsonString.trim() === "") {
              console.error("Empty text response from Gemini API despite requesting JSON.");
              throw new Error("Empty or invalid JSON string response from Gemini API.");
            }
          
            // Parse the JSON string to get the JavaScript object
            try {
              // Remove potential markdown backticks if the LLM adds them
              const cleanedJsonString = jsonString.replace(/^``````$/g, '').trim();
              problemInfo = JSON.parse(cleanedJsonString);
            } catch (parseError) {
              console.error("Failed to parse JSON response from Gemini API:", parseError);
              console.error("Original string from API:", jsonString);
              throw new Error(`Invalid JSON format received from Gemini API: ${parseError.message}`);
            }
          
          } catch (error) {
            console.error("Error using Gemini API for extraction:", error);
            let errorMessage = "Failed to process with Gemini API. Please check your API key or try again later.";
            if (error.message) {
              errorMessage = error.message;
              if (error.message.includes("API key not valid") || error.message.includes("PERMISSION_DENIED")) {
                  errorMessage = "Gemini API key is invalid or lacks permissions. Please check your configuration.";
              } else if (error.message.includes("quota")) {
                  errorMessage = "Gemini API quota exceeded. Please check your usage limits.";
              }
            }
            return {
              success: false,
              error: errorMessage
            };
          }
                    
      } else if (config.apiProvider === ApiProvider.Anthropic) {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: anthropicPrompt
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: data
                  }
                }))
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.extractionModel || "claude-3-7-sonnet-20250219",
            max_tokens: API_CONFIG.maxTokens.extraction,
            messages: messages,
            temperature: 0.2
          });

          const responseText = (response.content[0] as { type: 'text', text: string }).text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error: any) {
          console.error("Error using Anthropic API:", error);

          // Handle specific Anthropic/Claude error cases
          if (error?.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          }
          if (
            error?.status === 413 ||
            (typeof error?.message === "string" && error.message.toLowerCase().includes("token"))
          ) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to process with Anthropic API. Please check your API key or try again later."
          };
          
        }
      }
      
      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Problem analyzed successfully. Preparing to generate solution...",
          progress: 40
        });
      }

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      // Send first success event
      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Generate solutions after successful extraction
        const solutionsResult = await this.generateSolutionsHelper(signal);
        if (solutionsResult.success) {
          // Clear any existing extra screenshots before transitioning to solutions view
          this.screenshotHelper.clearExtraScreenshotQueue();
          
          // Final progress update
          mainWindow.webContents.send("processing-status", {
            message: "Solution generated successfully",
            progress: 100
          });
          
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          );
          return { success: true, data: solutionsResult.data };
        } else {
          throw new Error(
            solutionsResult.error || "Failed to generate solutions"
          );
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      // If the request was cancelled, don't retry
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      // Handle OpenAI API errors specifically
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid OpenAI API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "OpenAI API rate limit exceeded or insufficient credits. Please try again later."
        };
      } else if (error?.response?.status === 500) {
        return {
          success: false,
          error: "OpenAI server error. Please try again later."
        };
      }

      console.error("API Error Details:", error);
      return { 
        success: false, 
        error: error.message || "Failed to process screenshots. Please try again." 
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo || !problemInfo.problem_statement) {
        console.error("No problem statement available for solution generation.", problemInfo);
        return { success: false, error: "Problem statement extraction failed. Please try again with clearer screenshots." };
      }

      console.log("Problem info before solution generation:", problemInfo);

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }

      // Create prompt for solution generation
      const promptText = `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

I need the response in the following format:
1. Code: A clean, concise(within reason like dont use None everywhere), optimized implementation in ${language}.
2. Your Thoughts: A list of key insights and reasoning behind your approach - Like what is the approach to solving here that I can say explain to the engineer asking me this question. 
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences). Try to breakdown the answer in math,  like if there's a recurrence relation.
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences).  Try to breakdown the answer in math, like if there's a recurrence relation.

For complexity explanations:
- Time complexity should include a breakdown of any major top-level operations such as loops, recursion, sorting, or data structure operations. Explain how often each one runs and why they contribute to the overall time complexity. Avoid vague summaries—be precise about what drives the cost.
- Space complexity should explain all additional memory used beyond the input, including any data structures, caches, recursion stacks, etc. If space is constant, state why it does not grow with input size. If it's linear or more, clarify which parts of the algorithm are responsible.

Your solution should be efficient, well-commented, and handle edge cases.
`;

      let responseContent;
      

      if (config.apiProvider === ApiProvider.OpenAI) {
        // OpenAI processing
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        // Send to OpenAI API
        const solutionResponse = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: [
            { role: "system", content: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations." },
            { role: "user", content: promptText }
          ],
          max_completion_tokens: API_CONFIG.maxTokens.solution,
        });

        responseContent = solutionResponse.choices[0].message.content;
      } else if (config.apiProvider === ApiProvider.Gemini)  {
        // Gemini processing using GoogleGenAI SDK (with config object)
        if (!this.geminiClient) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const response = await this.geminiClient.models.generateContent({
            model: config.solutionModel || "gemini-2.0-flash",
            contents: `You are an expert coding interview assistant. Provide a clear, optimal, concise solution with detailed explanations for this problem:\n\n${promptText}`,
            config: {
              maxOutputTokens: API_CONFIG.maxTokens.solution,
              temperature: 0.2,
              candidateCount: 1,
              thinkingConfig: {
                thinkingBudget: 500
              }
            }
          });
          console.log("Using Gemini model:", config.solutionModel, "with response:", response);
          // Check for Gemini API errors: token limit or empty response
          if (response?.candidates?.[0]?.finishReason === "MAX_TOKENS") {
            console.error("Gemini API response stopped due to MAX_TOKENS:", response);
            throw new Error("Gemini API response stopped due to reaching the maximum token limit. Try using fewer or smaller screenshots, or a shorter prompt.");
          }
          if (!response?.text?.trim()) {
            throw new Error("Empty response from Gemini API");
          }

          responseContent = response.text;
        } catch (error) {
          console.error("Error using Gemini API for solution:", error);
          return {
            success: false,
            error: "Failed to generate solution with Gemini API. Please check your API key or try again later."
          };
        }

        
      } else if (config.apiProvider === ApiProvider.Anthropic) {
        // Anthropic processing
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Send to Anthropic API
          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: API_CONFIG.maxTokens.solution,
            messages: messages,
            temperature: 0.2
          });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for solution:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to generate solution with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      // Extract parts from the response
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;
      
      // Extract thoughts, looking for bullet points or numbered lists
      const thoughtsRegex = /(?:[0-9]+\.\s*)?(?:Your\s+)?(?:Thoughts|Key Insights|Reasoning|Approach|Your Thoughts)\b(?::)?([\s\S]*?)(?:Time complexity:|---|$)/i;
      
      const thoughtsMatch = responseContent.match(thoughtsRegex);
      let thoughts: string[] = [];
      
      if (thoughtsMatch && thoughtsMatch[1]) {
        const thoughtsBlock = thoughtsMatch[1].trim(); // Get the captured block and trim whitespace

        // Regex to extract individual bullet points or numbered items from the thoughtsBlock
        // - `^`: Start of a line (due to `m` flag)
        // - `\s*`: Optional leading whitespace
        // - `(?:[-*•]|\d+\.)`: Matches a bullet point marker (-, *, •) or a number followed by a dot
        // - `\s+`: One or more whitespace characters (to ensure there's a space after the marker)
        // - `(.*)`: Captures the rest of the line (the actual thought)
        // - `gm`: Global (find all matches) and Multiline (so ^ matches start of each line)
        const bulletPointRegex = /^\s*(?:[-*•]|\d+\.)\s+(.*)/gm; 
        
        let match;
        const extractedPoints = [];
        while ((match = bulletPointRegex.exec(thoughtsBlock)) !== null) {
          // match[1] contains the captured group (the text of the bullet point)
          extractedPoints.push(match[1].trim());
        }

        if (extractedPoints.length > 0) {
          thoughts = extractedPoints;
        } else if (thoughtsBlock) { 
          // If no bullet points were found but the thoughtsBlock has content,
          // split by newlines as a fallback.
          thoughts = thoughtsBlock.split('\n')
            .map((line) => line.trim())
            .filter(Boolean); // Remove any empty strings resulting from blank lines
        }
      }
      console.log("Thoughts:", thoughts);

  
      // These patterns account for optional markdown headers (e.g., "###"), optional numbering (e.g., "3."), 
      // optional markdown bolding (e.g., "**Time Complexity**"),
      // and ensure that captured content preserves internal newlines.

      // Matches "Time Complexity:" (case-insensitive), possibly prefixed by markdown header, numbered, and/or bolded.
      // Captures everything until "Space Complexity:" (similarly formatted) or end of string.
      const timeComplexityPattern = /(?:^|\n)[ \t]*(?:#+\s*)?(?:\d+\.\s*)?(?:\*\*)?Time\s*Complexity(?:\*\*)?:?\s*([\s\S]*?)(?=(?:^|\n)[ \t]*(?:#+\s*)?(?:\d+\.\s*)?(?:\*\*)?Space\s*Complexity(?:\*\*)?:?|$)/i;
      
      // Matches "Space Complexity:" (case-insensitive), possibly prefixed by markdown header, numbered, and/or bolded.
      // Captures everything until the next distinct section header line or end of string.
      // A "distinct section header line" is one that primarily consists of a title-like text (e.g., "5. Conclusion", "**Notes:**"),
      // optionally prefixed by markdown header, numbered/bolded, and is followed by a newline or end of string.
      const spaceComplexityPattern = /(?:^|\n)[ \t]*(?:#+\s*)?(?:\d+\.\s*)?(?:\*\*)?Space\s*Complexity(?:\*\*)?:?\s*([\s\S]*?)(?=(?:(?:^|\n)[ \t]*(?:#+\s*)?(?:(?:\d+\.\s*)?(?:\*\*)?[A-Z][A-Za-z0-9\s,'()\-]{1,80}(?:\*\*)?:?)\s*(?:\n|$))|$)/i;

      let timeComplexity = "Time-Error.";
      let spaceComplexity = "Space-Error."; // Corrected default to match the pattern of Time-Error.
      
      console.log("Response Content for complexity parsing:", responseContent);

      const timeMatch = responseContent.match(timeComplexityPattern);
      if (timeMatch && timeMatch[1]) {
        timeComplexity = timeMatch[1].replace(/\r\n/g, '\n').trim();
        if (timeComplexity === "") { // Handle explicitly empty content
            timeComplexity = "O(n) - Explanation needed";
        } else if (!timeComplexity.match(/O\([^)]+\)/i)) { // If no O(...) notation
          timeComplexity = `O(n) - ${timeComplexity}`;
        } else if (!timeComplexity.includes('-') && !timeComplexity.match(/because|driven by|due to|as|for example|where|which is|since|meaning/i)) {
          // If O(...) is present but no dash or common explanation keyword, add a dash
          const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = timeComplexity.substring(notation.length).trim();
            if (rest && !rest.startsWith('-')) {
                 timeComplexity = `${notation} - ${rest}`;
            } else if (!rest) { // Only notation was present
                 timeComplexity = `${notation} - Explanation needed`;
            }
          }
        }
      } else {
        console.warn("Could not parse Time Complexity from response.");
      }

      const spaceMatch = responseContent.match(spaceComplexityPattern);
      if (spaceMatch && spaceMatch[1]) {
        spaceComplexity = spaceMatch[1].replace(/\r\n/g, '\n').trim();
        if (spaceComplexity === "") { // Handle explicitly empty content
            spaceComplexity = "O(n) - Explanation needed";
        } else if (!spaceComplexity.match(/O\([^)]+\)/i)) { // If no O(...) notation
          spaceComplexity = `O(n) - ${spaceComplexity}`;
        } else if (!spaceComplexity.includes('-') && !spaceComplexity.match(/because|driven by|due to|as|for example|where|which is|since|meaning/i)) {
          const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = spaceComplexity.substring(notation.length).trim();
             if (rest && !rest.startsWith('-')) {
                 spaceComplexity = `${notation} - ${rest}`;
            } else if (!rest) { // Only notation was present
                 spaceComplexity = `${notation} - Explanation needed`;
            }
          }
        }
      } else {
        console.warn("Could not parse Space Complexity from response.");
      }


      const formattedResponse = {
        code: code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        time_complexity: timeComplexity,
        space_complexity: spaceComplexity
      };

      return { success: true, data: formattedResponse };
    } catch (error: any) {
      let errorMsg = "Failed to generate solution";

      if (axios.isCancel(error)) {
        errorMsg = "Processing was canceled by the user.";
      } else if (error?.response?.status === 401) {
        errorMsg = "Invalid OpenAI API key. Please check your settings.";
      } else if (error?.response?.status === 429) {
        errorMsg = "OpenAI API rate limit exceeded or insufficient credits. Please try again later.";
      } else if (error?.message) {
        errorMsg = error.message;
      }

      console.error("Solution generation error:", error);
      return { success: false, error: errorMsg };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      let debugContent;
      
      if (config.apiProvider === ApiProvider.OpenAI) {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        const messages = [
          {
            role: "system" as const, 
            content: `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

Your response MUST follow this exact structure with these section headers (use ### for headers):
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).`
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed` 
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback...",
            progress: 60
          });
        }

        const debugResponse = await this.openaiClient.chat.completions.create({
          model: config.debuggingModel || "gpt-4o",
          messages: messages,
          max_tokens: API_CONFIG.maxTokens.debugging,
        });
        
        debugContent = debugResponse.choices[0].message.content;
      } else if (config.apiProvider === ApiProvider.Gemini)  {
        if (!this.geminiClient) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).
`;

          // Prepare the content parts: text prompt + images as inlineData
          const contentParts = [
            { text: debugPrompt },
            ...imageDataList.map(data => ({
              inlineData: {
                mimeType: "image/png",
                data: data
              }
            }))
          ];

          // Call Gemini SDK
          const response = await this.geminiClient.models.generateContent({
            model: config.debuggingModel || "gemini-2.0-flash",
            contents: [
              {
                role: "user",
                parts: contentParts
              }
            ],
            config: {
              temperature: 0.2,
              maxOutputTokens: API_CONFIG.maxTokens.debugging
            }
          });

          // The SDK returns a response object with a 'text' property for the main content
          if (!response || !response.text || response.text.trim() === "") {
            throw new Error("Empty response from Gemini API");
          }

          debugContent = response.text;
        } catch (error) {
          console.error("Error using Gemini API for debugging:", error);
          return {
            success: false,
            error: "Failed to process debug request with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === ApiProvider.Anthropic) {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification.
`;

          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: debugPrompt
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const, 
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Claude...",
              progress: 60
            });
          }

          const response = await this.anthropicClient.messages.create({
            model: config.debuggingModel || "claude-3-7-sonnet-20250219",
            max_tokens: API_CONFIG.maxTokens.debugging,
            messages: messages,
            temperature: 0.2
          });
          
          debugContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for debugging:", error);
          
          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }
          
          return {
            success: false,
            error: "Failed to process debug request with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      // Extract code block if present, else use default message
      const extractedCode = (debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/)?.[1] || "// Debug mode - see analysis below").trim();

      // Add markdown headers if missing
      let formattedDebugContent = debugContent;
      if (!/#\s/.test(debugContent)) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      // Extract up to 5 bullet points, or use default
      const thoughts = (formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g) || [])
        .map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim())
        .slice(0, 5);

      return {
        success: true,
        data: {
          code: extractedCode,
          debug_analysis: formattedDebugContent,
          thoughts: thoughts.length ? thoughts : ["Debug analysis based on your screenshots"],
          time_complexity: "N/A - Debug mode",
          space_complexity: "N/A - Debug mode"
        }
      };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
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
