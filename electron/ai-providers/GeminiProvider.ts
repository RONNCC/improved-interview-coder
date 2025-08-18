import { GoogleGenAI } from "@google/genai";
import { IAiProvider, ProblemInfo, Solution, DebugResult, ApiKeyError } from "./IAiProvider";
import { API_CONFIG } from "../ConfigHelper";
import { AppConfig } from "../ConfigHelper";

export class GeminiProvider implements IAiProvider {
    private client: GoogleGenAI;
    private config: AppConfig;

    constructor(client: GoogleGenAI, config: AppConfig) {
        this.client = client;
        this.config = config;
    }

    private handleError(error: any): never {
        if (error?.message?.includes("API key not valid") || error?.message?.includes("PERMISSION_DENIED")) {
            throw new ApiKeyError("Gemini API key is invalid or lacks permissions. Please check your configuration.");
        }
        if (error?.message?.includes("quota")) {
            throw new Error("Gemini API quota exceeded. Please check your usage limits.");
        }
        throw error;
    }

    async extractProblemInfo(screenshots: { data: string; }[], language: string, _signal?: AbortSignal): Promise<ProblemInfo> {
        try {
            const systemPrompt = `You are a coding challenge interpreter and problem solver. You are given a screenshot of a coding challenge and you need to extract the problem statement, constraints, example inputs, and example outputs. If there is any starter code provided, extract that as well. Structure your response as a JSON object with the following keys: "problem_statement", "constraints", "example_input", "example_output", "preexisting_code".`

            const contentParts = [
                { text: systemPrompt },
                ...screenshots.map(s => ({
                    inlineData: {
                        mimeType: "image/png",
                        data: s.data
                    }
                }))
            ];

            const result = await this.client.models.generateContent({
                model: this.config.extractionModel || "gemini-1.5-flash-latest",
                contents: [{ role: "user", parts: contentParts }]
            });

            const problemInfoJson = result.candidates?.[0]?.content?.parts?.[0]?.text || ""
            const problemInfo = JSON.parse(problemInfoJson)

            return {
                problem_statement: problemInfo.problem_statement || "Could not determine",
                constraints: problemInfo.constraints,
                example_input: problemInfo.example_input,
                example_output: problemInfo.example_output,
                preexisting_code: problemInfo.preexisting_code
            }
        } catch (error: any) {
            this.handleError(error)
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

PRE-EXISTING CODE:
${problemInfo.preexisting_code || "No preexisting code provided."}

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

            const result = await this.client.models.generateContent({
                model: this.config.solutionModel || "gemini-1.5-flash-latest",
                contents: [{ role: "user", parts: [{ text: promptText }] }]
            });

            const responseContent = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

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
            const userDebugPrompt = `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. The attached screenshots show my current code, error messages, or test case failures.${additionalText ? `\n\nADDITIONAL CONTEXT FROM USER:\n${additionalText}` : ""}${problemInfo.preexisting_code ? `\n\nPRE-EXISTING CODE:\n${problemInfo.preexisting_code}` : ""}`;

            const contentParts = [
                { text: `${systemDebugPrompt}\n\n${userDebugPrompt}` },
                ...screenshots.map(s => ({
                    inlineData: {
                        mimeType: "image/png",
                        data: s.data
                    }
                }))
            ];

            const result = await this.client.models.generateContent({
                model: this.config.debuggingModel || "gemini-1.5-flash-latest",
                contents: [{ role: "user", parts: contentParts }]
            });

            const debugContent = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
            
            const extractedCode = (debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/)?.[1] || "// Debug mode - see analysis below").trim();
            const thoughts = (debugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g) || [])
                .map((point: string) => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim())
                .slice(0, 5);

            return {
                code: extractedCode,
                debug_analysis: debugContent,
                thoughts: thoughts.length ? thoughts : ["Debug analysis based on your screenshots"],
                time_complexity: "N/A - Debug mode",
                space_complexity: "N/A - Debug mode"
            };
        } catch (error: any) {
            this.handleError(error);
        }
    }
}