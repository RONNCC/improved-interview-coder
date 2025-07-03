import { OpenAI } from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { IAiProvider, ProblemInfo, Solution, DebugResult, ApiKeyError } from "./IAiProvider";
import { API_CONFIG } from "../ProcessingHelper";
import { AppConfig } from "../ConfigHelper";

export class OpenAiProvider implements IAiProvider {
  private client: OpenAI;
  private config: AppConfig;

  constructor(client: OpenAI, config: AppConfig) {
    this.client = client;
    this.config = config;
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

      const ProblemExtraction = z.object({
        problem_statement: z.string(),
        constraints: z.string().optional(),
        example_input: z.string().optional(),
        example_output: z.string().optional(),
      });

      const options = signal ? { signal } : {};
      const extractionResponse = await this.client.beta.chat.completions.parse({
        model: this.config.extractionModel || "gpt-4o",
        messages: messages,
        response_format: zodResponseFormat(ProblemExtraction, "problem_extraction"),
        max_completion_tokens: API_CONFIG.maxTokens.extraction,
      }, options);

      const problemInfo = extractionResponse.choices[0].message.parsed;
      if (!problemInfo || !problemInfo.problem_statement) {
        throw new Error("Failed to parse problem information from OpenAI response.");
      }
      return problemInfo as ProblemInfo;
    } catch (error) {
      this.handleError(error);
    }
  }

  async generateSolution(problemInfo: ProblemInfo, language: string, signal?: AbortSignal, additionalText?: string): Promise<Solution> {
    try {
      var promptText = `
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
1. Code: A clean, simple, readable implementation (it's ok to use python built-in libraries if it makes sense like collections,itertools,heapq) in ${language}.
2. Your Thoughts: List of key insights and reasoning behind the approach -- I need to explain simply to the engineer asking me this question.
3. Time complexity: O(X) with a simple but thorough explanation (at least 2 sentences). Try to breakdown the answer in math,  like if there's a recurrence relation explain it so I can show my work.
4. Space complexity: O(X) with a simple but thorough explanation (at least 2 sentences).  Try to breakdown the answer in math,  like if there's a recurrence relation explain it so I can show my work.

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

Your solution should be efficient, well-commented, and handle edge cases.`;

      if (additionalText?.trim()) {
        promptText += `\n\nADDITIONAL CONTEXT:\n${additionalText.trim()}\n\nPlease use this context in your solution.`;
      }

      const options = signal ? { signal } : {};
      const solutionResponse = await this.client.chat.completions.create({
        model: this.config.solutionModel || "gpt-4o",
        messages: [
          { role: "system", content: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations." },
          { role: "user", content: promptText }
        ],
        max_completion_tokens: API_CONFIG.maxTokens.solution,
      }, options);

      const responseContent = solutionResponse.choices[0].message.content || "";
      
      // All the response parsing logic is now encapsulated here.
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;
      
      const thoughtsRegex = /(?:[0-9]+\.\s*)?(?:Your\s+)?(?:Thoughts|Key Insights|Reasoning|Approach|Your Thoughts)\b(?::)?([\s\S]*?)(?:Time complexity:|---|$)/i;
      const thoughtsMatch = responseContent.match(thoughtsRegex);
      let thoughts: string[] = [];
      if (thoughtsMatch && thoughtsMatch[1]) {
        const thoughtsBlock = thoughtsMatch[1].trim();
        const bulletPointRegex = /^\s*(?:[-*•]|\d+\.)\s+(.*)/gm;
        let match;
        while ((match = bulletPointRegex.exec(thoughtsBlock)) !== null) {
          thoughts.push(match[1].trim());
        }
        if (thoughts.length === 0 && thoughtsBlock) {
          thoughts = thoughtsBlock.split('\n').map(line => line.trim()).filter(Boolean);
        }
      }

      const timeComplexityPattern = /(?:^|\n)[ \t]*(?:#+\s*)?(?:\d+\.\s*)?(?:\*\*)?Time\s*Complexity(?:\*\*)?:?\s*([\s\S]*?)(?=(?:^|\n)[ \t]*(?:#+\s*)?(?:\d+\.\s*)?(?:\*\*)?Space\s*Complexity(?:\*\*)?:?|$)/i;
      const timeMatch = responseContent.match(timeComplexityPattern);
      const time_complexity = timeMatch?.[1]?.trim() || "Not found.";

      const spaceComplexityPattern = /(?:^|\n)[ \t]*(?:#+\s*)?(?:\d+\.\s*)?(?:\*\*)?Space\s*Complexity(?:\*\*)?:?\s*([\s\S]*?)(?=(?:(?:^|\n)[ \t]*(?:#+\s*)?(?:(?:\d+\.\s*)?(?:\*\*)?[A-Z][A-Za-z0-9\s,'()-]{1,80}(?:\*\*)?:?)\s*(?:\n|$))|$)/i;
      const spaceMatch = responseContent.match(spaceComplexityPattern);
      const space_complexity = spaceMatch?.[1]?.trim() || "Not found.";

      return {
        code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        time_complexity,
        space_complexity,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async debugSolution(problemInfo: ProblemInfo, screenshots: { data: string; }[], language: string, signal?: AbortSignal, additionalText?: string): Promise<DebugResult> {
    try {
      const systemDebugPrompt = `You are a coding interview assistant helping debug and improve solutions. Analyze the user's screenshots and text to provide detailed debugging help...`; // (prompt truncated for brevity)
      const userDebugPrompt = `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help...${additionalText ? `\n\nADDITIONAL CONTEXT FROM USER:\n${additionalText}`: ""}`; // (prompt truncated for brevity)

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

      const options = signal ? { signal } : {};
      const debugResponse = await this.client.chat.completions.create({
        model: this.config.debuggingModel || "gpt-4o",
        messages: messages,
        max_completion_tokens: API_CONFIG.maxTokens.debugging,
      }, options);

      const debugContent = debugResponse.choices[0].message.content || "";
      const extractedCode = (debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/)?.[1] || "// Debug mode - see analysis below").trim();
      const thoughts = (debugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g) || [])
        .map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim())
        .slice(0, 5);

      return {
        code: extractedCode,
        debug_analysis: debugContent,
        thoughts: thoughts.length ? thoughts : ["Debug analysis based on your screenshots"],
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
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

    const completion = await this.client.chat.completions.create({
      model: this.config.solutionModel || "gpt-4o",
      messages: conversation as any
    } as any)

    const reply = completion.choices?.[0]?.message?.content || ""
    return { role: "assistant", content: reply }
  }
}