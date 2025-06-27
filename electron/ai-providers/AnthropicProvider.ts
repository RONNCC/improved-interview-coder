import Anthropic from '@anthropic-ai/sdk';
import { IAiProvider, ProblemInfo, Solution, DebugResult, ApiKeyError } from "./IAiProvider";
import { API_CONFIG } from "../ProcessingHelper";
import { AppConfig } from "../ConfigHelper";

export class AnthropicProvider implements IAiProvider {
    private client: Anthropic;
    private config: AppConfig;

    constructor(client: Anthropic, config: AppConfig) {
        this.client = client;
        this.config = config;
    }

    private handleError(error: any): never {
        if (error?.status === 401) {
            throw new ApiKeyError("Invalid Anthropic API key. Please check your settings.");
        }
        if (error?.status === 429) {
            throw new Error("Anthropic API rate limit exceeded. Please try again later.");
        }
        if (error?.status === 500) {
            throw new Error("Anthropic server error. Please try again later.");
        }
        throw error;
    }

    async extractProblemInfo(screenshots: { data: string; }[], language: string, _signal?: AbortSignal): Promise<ProblemInfo> {
        try {
            const anthropicPrompt = `Extract the coding problem details from these screenshots. Return in JSON format with these fields: problem_statement, constraints, example_input, example_output. Preferred coding language is ${language}.`;

            const messages: any = [
                {
                    role: "user" as const,
                    content: [
                        {
                            type: "text" as const,
                            text: anthropicPrompt
                        },
                        ...screenshots.map(s => ({ // Corrected to use s.data
                            type: "image" as const,
                            source: {
                                type: "base64" as const,
                                media_type: "image/png" as const,
                                data: s.data
                            }
                        }))
                    ]
                }
            ];

            const response = await this.client.messages.create({
                model: this.config.extractionModel || "claude-3-opus-20240229", // Using latest Claude 3 Opus
                max_tokens: API_CONFIG.maxTokens.extraction,
                messages: messages,
                temperature: 0.2,
                // Anthropic doesn't support AbortSignal directly
            });

            const responseText = (response.content[0] as { type: 'text', text: string }).text;
            const jsonText = responseText.replace(/```json|```/g, '').trim();
            return JSON.parse(jsonText);
        } catch (error: any) {
            this.handleError(error);
        }
    }

    async generateSolution(problemInfo: ProblemInfo, language: string, _signal?: AbortSignal, additionalText?: string): Promise<Solution> {
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

            const response = await this.client.messages.create({
                model: this.config.solutionModel || "claude-3-opus-20240229",
                max_tokens: API_CONFIG.maxTokens.solution,
                messages: [
                    {
                        role: "user" as const,
                        content: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                    }
                ],
                temperature: 0.2,
                // Anthropic doesn't support AbortSignal directly
            });

            const responseContent = (response.content[0] as { type: 'text', text: string }).text;
            const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
            const code = codeMatch ? codeMatch[1].trim() : responseContent;
            
            // Anthropic often provides thoughts and complexities in a structured way.
            // Re-implementing the parsing logic from ProcessingHelper.ts here.
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
                    thoughts = thoughtsBlock.split('\n').map((line: string) => line.trim()).filter(Boolean);
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
        } catch (error: any) {
            this.handleError(error);
        }
    }

    async debugSolution(problemInfo: ProblemInfo, screenshots: { data: string; }[], language: string, _signal?: AbortSignal, additionalText?: string): Promise<DebugResult> {
        try {
            const systemDebugPrompt = `You are a coding interview assistant helping debug and improve solutions. Analyze the user's screenshots and text to provide detailed debugging help. Your response MUST follow this exact structure with these section headers (use ### for headers): ### Issues Identified - List each issue as a bullet point with clear explanation ### Specific Improvements and Corrections - List specific code changes needed as bullet points ### Optimizations - List any performance optimizations if applicable ### Explanation of Changes Needed Here provide a clear explanation of why the changes are needed ### Key Points - Summary bullet points of the most important takeaways If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).`;
            const userDebugPrompt = `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. The attached screenshots show my current code, error messages, or test case failures.${additionalText ? `\n\nADDITIONAL CONTEXT FROM USER:\n${additionalText}` : ""}`;
            
            const messages: any = [
                {
                    role: "user" as const,
                    content: [
                        { type: "text", text: `${systemDebugPrompt}\n\n${userDebugPrompt}` },
                        ...screenshots.map(s => ({
                            type: "image" as const,
                            source: {
                                type: "base64" as const,
                                media_type: "image/png" as const,
                                data: s.data
                            }
                        }))
                    ]
                }
            ];

            const response = await this.client.messages.create({
                model: this.config.debuggingModel || "claude-3-opus-20240229",
                max_tokens: API_CONFIG.maxTokens.debugging,
                messages: messages,
                temperature: 0.2,
                // signal: signal,
            });
            const debugContent = (response.content[0] as { type: 'text', text: string }).text;
            
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
}