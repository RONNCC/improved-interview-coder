import { OpenAI } from "openai";
import { z } from "zod";
import { IAiProvider, ProblemInfo, Solution, DebugResult, ApiKeyError } from "./IAiProvider";
import { API_CONFIG } from "../ConfigHelper";
import { AppConfig } from "../ConfigHelper";

export class OpenAiProvider implements IAiProvider {
  private client: OpenAI;
  private config: AppConfig;
  private lastResponseId?: string;

  constructor(client: OpenAI, config: AppConfig) {
    this.client = client;
    this.config = config;
  }

  private isThinkingVariant(model: string): boolean {
    return model.endsWith("-thinking");
  }

  private normalizeModelName(model: string): string {
    return this.isThinkingVariant(model) ? model.replace(/-thinking$/, "") : model;
  }

  private buildInputFromMessages(messages: Array<{ role: string; content: any }>): Array<{ role: string; content: Array<{ type: string; text?: string; image_url?: string }> }> {
    return messages.map((message) => {
      if (typeof message.content === "string") {
        return {
          role: message.role,
          content: [{ type: "input_text", text: message.content }]
        };
      }

      if (Array.isArray(message.content)) {
        const content = message.content.map((part: any) => {
          if (part?.type === "text") {
            return { type: "input_text", text: part.text };
          }
          if (part?.type === "image_url") {
            return { type: "input_image", image_url: part.image_url?.url };
          }
          if (part?.type === "input_text" || part?.type === "input_image") {
            return part;
          }
          return { type: "input_text", text: String(part?.text ?? "") };
        });

        return { role: message.role, content };
      }

      return {
        role: message.role,
        content: [{ type: "input_text", text: String(message.content ?? "") }]
      };
    });
  }

  private buildResponsesParams(model: string, input: any, maxOutputTokens: number, usePreviousResponseId: boolean): any {
    const normalizedModel = this.normalizeModelName(model);
    const params: any = {
      model: normalizedModel,
      input,
      max_output_tokens: maxOutputTokens
    };

    if (this.isThinkingVariant(model)) {
      params.reasoning = { effort: "medium" };
    }

    if (usePreviousResponseId && this.lastResponseId) {
      params.previous_response_id = this.lastResponseId;
    }

    return params;
  }

  private getResponseText(response: any): string {
    if (response?.output_text) {
      return response.output_text;
    }

    const content = response?.output?.[0]?.content || [];
    for (const item of content) {
      if (item?.type === "output_text" || item?.type === "text") {
        return item.text || "";
      }
    }

    return "";
  }

  private parseJsonResponse(responseText: string): any {
    try {
      return JSON.parse(responseText);
    } catch (error) {
      const startIndex = responseText.indexOf("{");
      const endIndex = responseText.lastIndexOf("}");
      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const jsonBlock = responseText.slice(startIndex, endIndex + 1);
        return JSON.parse(jsonBlock);
      }
      throw new Error("OpenAI response was not valid JSON.");
    }
  }

  private recordResponseId(response: any): void {
    if (response?.id) {
      this.lastResponseId = response.id;
    }
  }

  private handleError(error: any): never {
    if (error?.status === 401) {
      throw new ApiKeyError("Invalid OpenAI API key. Please check your settings.");
    }
    if (error?.status === 429) {
      throw new Error("OpenAI API rate limit exceeded or insufficient credits. Please try again later.");
    }
    if (error?.status === 500) {
      throw new Error("OpenAI server error. Please try again later.");
    }
    if (error?.message?.includes("unknown") || error?.message?.includes("reasoning")) {
      console.warn("Reasoning parameter may not be supported for this endpoint:", error?.message);
      throw new Error(`API error: ${error?.message || "Unknown error. The reasoning parameter may not be supported for this model or endpoint."}`);
    }
    throw error;
  }

  async extractProblemInfo(screenshots: { data: string; }[], language: string, signal?: AbortSignal): Promise<ProblemInfo> {
    try {
      const openAIPromptSystem = "You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information including examples and any classes already given. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text. Also try to roughly return if there is any initial starting code. ";
      const openAIPromptUser = `Extract the coding problem details from these screenshots verbosely. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.`;

      const messages: any = [
        { role: "system", content: openAIPromptSystem },
        {
          role: "user",
          content: [
            { type: "text", text: openAIPromptUser },
            ...screenshots.map(s => ({
              type: "image_url",
              image_url: { url: `data:image/png;base64,${s.data}` }
            }))
          ]
        }
      ];

      const ProblemExtractionSchema = z.object({
        problem_statement: z.string(),
        constraints: z.string().nullable().optional(),
        example_input: z.string().nullable().optional(),
        example_output: z.string().nullable().optional(),
        preexisting_code: z.string().nullable().optional()
      });

      const model = this.config.extractionModel || "gpt-4o";
      const input = this.buildInputFromMessages(messages);
      const extraction = await this.client.responses.create(
        this.buildResponsesParams(model, input, API_CONFIG.maxTokens.extraction, false),
        signal ? { signal } : undefined
      );

      const responseText = this.getResponseText(extraction);
      const parsed = ProblemExtractionSchema.parse(this.parseJsonResponse(responseText));
      // console.log("Problem info parsed", parsed)

      return {
        problem_statement: parsed.problem_statement,
        constraints: parsed.constraints ?? undefined,
        example_input: parsed.example_input ?? undefined,
        example_output: parsed.example_output ?? undefined,
        preexisting_code: parsed.preexisting_code ?? undefined
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async generateSolution(problemInfo: ProblemInfo, language: string, signal?: AbortSignal, additionalText?: string): Promise<Solution> {
    console.log("generateSolution received additionalText:", additionalText)
    try {
      var promptText = `
Generate a detailed solution for the following coding problem and return JSON only.

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

  EXAMPLE OUTPUT:
  ${problemInfo.example_output || "No example output provided."}

  PRE-EXISTING CODE:
  ${problemInfo.preexisting_code || "No preexisting code provided."}

LANGUAGE: ${language}

Return JSON with these fields only:
- code (string): Clean, simple, readable implementation in ${language}. Use built-in libs if helpful.
- thoughts (array of strings): Key insights and reasoning behind the approach.
- time_complexity (string): O(X) with at least 2 sentences explaining the math.
- space_complexity (string): O(X) with at least 2 sentences explaining the math.

<code_notes>
I'm going into a coding interview (potentially an incremental problem). Give simple, short, and optimized code
Be concise and err on simplicity in comments/docs since is a coding interview and i have limited time to read.
Don't waste extra characters doing things like validating types if already provided via annotations.
Try to front-load important validations and add defensive checks at the beginning if needed.
If there's already existing code take that into account, such as for reuse.
</code_notes>

<complexity_notes>
- For time complexity, break down the main operations (like loops, recursion, sorting, or data structure use). Say how many times each runs and why. Be specific about what affects the time cost.
- For space complexity, explain any extra memory used besides the input (like data structures or recursion stack). If it's constant, say why. If it's more, mention what causes it.
</complexity_notes>

Your solution should be efficient, well-commented, and handle edge cases.
Return JSON only. No extra text.

`;

      if (additionalText?.trim()) {
        promptText += `\n\nADDITIONAL CONTEXT:\n${additionalText.trim()}\n\nPlease use this context in your solution.`;
      }

      const SolutionSchema = z.object({
        code: z.string(),
        thoughts: z.array(z.string()),
        time_complexity: z.string(),
        space_complexity: z.string()
      });

      const model = this.config.solutionModel || "gpt-4o";
      const input = this.buildInputFromMessages([
        { role: "system", content: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations." },
        { role: "user", content: promptText }
      ]);
      const solutionResponse = await this.client.responses.create(
        this.buildResponsesParams(model, input, API_CONFIG.maxTokens.solution, false),
        signal ? { signal } : undefined
      );

      const responseText = this.getResponseText(solutionResponse);
      const parsed = SolutionSchema.parse(this.parseJsonResponse(responseText));

      return {
        code: parsed.code,
        thoughts: parsed.thoughts,
        time_complexity: parsed.time_complexity,
        space_complexity: parsed.space_complexity,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async debugSolution(problemInfo: ProblemInfo, screenshots: { data: string; }[], language: string, signal?: AbortSignal, additionalText?: string): Promise<DebugResult> {
    console.log("debugSolution received additionalText:", additionalText)
    try {
      const systemDebugPrompt = `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help. Return JSON only.

Your response MUST include
- issues identified (or state "None" if there are none): List each issue as a bullet point with a clear explanation
-  Specific Improvements and Corrections: List specific code changes needed as bullet points
- Optimizations:  List any performance optimizations if applicable
-  Explanation of Changes Needed: Provide a clear explanation of why the changes are needed
- Key Points: Summary bullet points of the most important takeaways

Return JSON with these fields only:
- code (string)
- debug_analysis (string)
- thoughts (array of strings)
- time_complexity (string)
- space_complexity (string)

Return JSON only. No extra text.
`;
      const userDebugPrompt = `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language} and need help debugging the current code I have against the requirements. I need help...${additionalText ? `\n\nADDITIONAL CONTEXT FROM USER:\n${additionalText}`: ""}${problemInfo.preexisting_code ? `\n\nPRE-EXISTING CODE:\n${problemInfo.preexisting_code}` : ""}`;

      const messages: any = [
        { role: "system", content: systemDebugPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userDebugPrompt },
            ...screenshots.map(s => ({
              type: "image_url",
              image_url: { url: `data:image/png;base64,${s.data}` }
            }))
          ]
        }
      ];

      const DebugSchema = z.object({
        code: z.string(),
        debug_analysis: z.string(),
        thoughts: z.array(z.string()).optional(),
        time_complexity: z.string().optional(),
        space_complexity: z.string().optional()
      });

      const model = this.config.debuggingModel || "gpt-4o";
      const input = this.buildInputFromMessages(messages);
      const debugResponse = await this.client.responses.create(
        this.buildResponsesParams(model, input, API_CONFIG.maxTokens.debugging, false),
        signal ? { signal } : undefined
      );

      const responseText = this.getResponseText(debugResponse);
      const parsed = DebugSchema.parse(this.parseJsonResponse(responseText));
      console.log("debug Response parsed", parsed);

      return {
        code: parsed.code,
        debug_analysis: parsed.debug_analysis,
        thoughts: parsed.thoughts || [],
        time_complexity: parsed.time_complexity || "N/A",
        space_complexity: parsed.space_complexity || "N/A"
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * General chat completion that supports images pasted by the user (as file paths on disk).
   */
  async chatComplete(messages: Array<{ role: string; content: string; isImage?: boolean }>): Promise<{ role: string; content: string }> {
    // Transform messages: embed images as data URLs that OpenAI understands
    const transformed = messages.map((m) => {
      if (m.isImage) {
        try {
          const buffer = require("fs").readFileSync(m.content)
          const base64 = buffer.toString("base64")
          return {
            role: m.role,
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64}` }
              }
            ]
          }
        } catch (err) {
          console.error("Failed to embed image", err)
          return { role: m.role, content: `Image: ${m.content}` }
        }
      }
      return { role: m.role, content: m.content }
    })

    // Ensure a system message exists
    const conversation = transformed.length && transformed[0].role === "system"
      ? transformed
      : [{ role: "system", content: "You are a helpful AI assistant." }, ...transformed]

    const model = this.config.solutionModel || "gpt-4o";
    const input = this.buildInputFromMessages(conversation as any);
    const completion = await this.client.responses.create(
      this.buildResponsesParams(model, input, API_CONFIG.maxTokens.solution, true)
    );
    this.recordResponseId(completion);

    const reply = this.getResponseText(completion);
    return { role: "assistant", content: reply }
  }
}