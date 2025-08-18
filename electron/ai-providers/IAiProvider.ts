export class ApiKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ApiKeyError';
    }
}

export interface ProblemInfo {
  problem_statement: string;
  constraints?: string;
  example_input?: string;
  example_output?: string;
  preexisting_code?: string;
}

export interface Solution {
  code: string;
  thoughts: string[];
  time_complexity: string;
  space_complexity: string;
}

export interface DebugResult {
    code: string;
    debug_analysis: string;
    thoughts: string[];
    time_complexity: string;
    space_complexity: string;
}

export interface IAiProvider {
  extractProblemInfo(
    screenshots: Array<{ data: string }>,
    language: string,
    signal?: AbortSignal
  ): Promise<ProblemInfo>;

  generateSolution(
    problemInfo: ProblemInfo,
    language: string,
    signal?: AbortSignal,
    additionalText?: string
  ): Promise<Solution>;

  debugSolution(
    problemInfo: ProblemInfo,
    screenshots: Array<{ data:string }>,
    language: string,
    signal?: AbortSignal,
    additionalText?: string
  ): Promise<DebugResult>;

  /** Chat completion for general conversation (optional) */
  chatComplete?(
    messages: Array<{ role: string; content: string; isImage?: boolean }>
  ): Promise<{ role: string; content: string }>
}