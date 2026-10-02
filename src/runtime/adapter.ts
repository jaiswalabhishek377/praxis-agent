import dotenv from 'dotenv';
dotenv.config();
import { z } from 'zod';
import pRetry, { AbortError } from 'p-retry';
import Groq from 'groq-sdk';

// ─── Resilient Parameter Schemas (Handles LLM Quirks) ────────────
// Coerces types (e.g. "1" -> 1) and accepts common aliases (prompt/question, etc.)
export const ActionSchemas = {
  browser_navigate: z.object({
    url: z.string().min(1).describe('The URL or path to navigate to'),
  }),
  browser_click: z.object({
    ref: z.coerce.number().int().positive().describe('Numeric element reference ID from the DOM snapshot'),
  }),
  browser_type: z.object({
    ref: z.coerce.number().int().positive().describe('Numeric element reference ID from the DOM snapshot'),
    text: z.string().min(1).describe('Text to type into the input field'),
  }),
  browser_select: z.object({
    ref: z.coerce.number().int().positive().describe('Numeric element reference ID of the select dropdown'),
    value: z.string().min(1).describe('The exact option text or value to select'),
  }),
  browser_get_text: z.object({
    ref: z.coerce.number().int().positive().describe('Numeric element reference ID to read full text from'),
  }),
  browser_snapshot: z.object({}).optional().default({}),
  list_files: z.object({
    dir: z.string().optional().default('src/test-data'),
  }),
  read_file: z.object({
    path: z.string().min(1).describe('Relative or absolute path to the file to read'),
  }),
  system_login: z.object({
    system: z.string().min(1).describe('The name of the system to log into (e.g., "erp")'),
  }),
  ask_user: z
    .object({
      question: z.string().optional(),
      prompt: z.string().optional(),
      message: z.string().optional(),
    })
    .refine((val) => Boolean(val.question?.trim() || val.prompt?.trim() || val.message?.trim()), {
      message: 'ask_user requires a non-empty question or prompt string',
    })
    .transform((val) => ({
      question: (val.question || val.prompt || val.message)!.trim(),
    })),
  finish: z
    .object({
      status: z.enum(['success', 'failed', 'needs_help']).default('success'),
      summary: z.string().optional(),
      message: z.string().optional(),
      result: z.string().optional(),
      evidence: z.string().optional(),
    })
    .refine((val) => Boolean(val.summary?.trim() || val.message?.trim() || val.result?.trim()), {
      message: 'finish requires a non-empty summary describing the task outcome',
    })
    .transform((val) => ({
      status: val.status,
      summary: (val.summary || val.message || val.result)!.trim(),
      evidence: val.evidence,
    })),
};

export const AgentActionSchema = z.discriminatedUnion('action', [
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('browser_navigate'),
    params: ActionSchemas.browser_navigate,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('browser_click'),
    params: ActionSchemas.browser_click,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('browser_type'),
    params: ActionSchemas.browser_type,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('browser_select'),
    params: ActionSchemas.browser_select,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('browser_get_text'),
    params: ActionSchemas.browser_get_text,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('browser_snapshot'),
    params: ActionSchemas.browser_snapshot.optional().default({}),
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('list_files'),
    params: ActionSchemas.list_files,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('read_file'),
    params: ActionSchemas.read_file,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('ask_user'),
    params: ActionSchemas.ask_user,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('system_login'),
    params: ActionSchemas.system_login,
  }),
  z.object({
    thought: z.string().describe('Step reasoning'),
    action: z.literal('finish'),
    params: ActionSchemas.finish,
  }),
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

// ─── Format Instructions Appended to System Instruction ──────────
export const SCHEMA_INSTRUCTIONS = `
CRITICAL INSTRUCTION: You MUST respond ONLY with a single valid JSON object adhering to this schema:
{
  "thought": "Brief explanation of your thinking and next action",
  "action": "browser_navigate" | "browser_click" | "browser_type" | "browser_select" | "browser_get_text" | "browser_snapshot" | "list_files" | "read_file" | "system_login" | "ask_user" | "finish",
  "params": { ... }
}

Action parameters:
- browser_navigate: { "url": "http://..." }
- browser_click: { "ref": 1 }
- browser_type: { "ref": 1, "text": "value" }
- browser_select: { "ref": 1, "value": "option text" }
- browser_get_text: { "ref": 1 }
- browser_snapshot: {}
- list_files: { "dir": "src/test-data/invoices" }
- read_file: { "path": "path/to/file.json" }
- system_login: { "system": "erp" }
- ask_user: { "question": "..." }
- finish: { "status": "success" | "failed" | "needs_help", "summary": "...", "evidence": "..." }

Never output markdown wrappers, conversational text, or XML tags outside the JSON.`;

// ─── Tracing & Token Metrics Types ──────────────────────────────
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AttemptTrace {
  provider: 'gemini' | 'groq';
  model: string;
  status: 'success' | 'error' | 'repaired';
  httpStatus?: number;
  latencyMs: number;
  error?: string;
}

export interface ModelCallResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  provider: 'gemini' | 'groq';
  attempts: AttemptTrace[];
}

// ─── RunTracker (Per-Run / Per-Evaluation Metrics) ───────────────
export class RunTracker {
  public calls: number = 0;
  public promptTokens: number = 0;
  public completionTokens: number = 0;
  public totalTokens: number = 0;
  public attempts: AttemptTrace[] = [];
  public modelUsage: Record<string, number> = {};

  public record<T>(result: ModelCallResult<T>): void {
    this.calls++;
    this.promptTokens += result.usage.promptTokens;
    this.completionTokens += result.usage.completionTokens;
    this.totalTokens += result.usage.totalTokens;
    this.attempts.push(...result.attempts);
    this.modelUsage[result.model] = (this.modelUsage[result.model] || 0) + 1;
  }

  public recordFailedAttempts(attempts: AttemptTrace[]): void {
    this.attempts.push(...attempts);
  }

  public getSummary() {
    return {
      calls: this.calls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      modelUsage: { ...this.modelUsage },
      totalAttempts: this.attempts.length,
      fallbackEvents: this.attempts.filter((a) => a.status === 'error').length,
    };
  }

  public reset(): void {
    this.calls = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.attempts = [];
    this.modelUsage = {};
  }
}

// ─── Cascades ───────────────────────────────────────────────────
export const GEMINI_CASCADE = [
  'gemini-3.5-flash-lite',    // Tier 1: Fastest (~0.9s), ultra-cheap
  'gemini-flash-lite-latest', // Tier 2: Official stable alias (~1.3s)
  'gemini-3-flash-preview',   // Tier 3: High reliability preview (~1.9s)
  'gemini-3.1-flash-lite',    // Tier 4: Solid fallback (~2.5s)
];

export const GROQ_CASCADE = [
  'openai/gpt-oss-120b',     // Deep reasoning + tool use
  'openai/gpt-oss-20b',      // Fast routine fallback
  'llama-3.3-70b-versatile', // Mature & stable fallback
];

// ─── Circuit Breaker State ──────────────────────────────────────
interface CircuitBreaker {
  failures: number;
  openUntil: number;
}

const geminiBreaker: CircuitBreaker = { failures: 0, openUntil: 0 };
const groqBreaker: CircuitBreaker = { failures: 0, openUntil: 0 };

function isBreakerOpen(breaker: CircuitBreaker): boolean {
  return breaker.openUntil > Date.now();
}

function recordSuccess(breaker: CircuitBreaker) {
  breaker.failures = 0;
  breaker.openUntil = 0;
}

function recordFailure(breaker: CircuitBreaker) {
  breaker.failures++;
  if (breaker.failures >= 2) {
    breaker.openUntil = Date.now() + 60_000;
    console.warn(`[Adapter] Circuit breaker tripped! Skipping provider for 60s.`);
  }
}

// ─── Robust JSON Sanitizer ──────────────────────────────────────
export function sanitizeAndParseJson(raw: string): any {
  let text = raw.trim();

  // Strip reasoning blocks (<think>...</think>) from Qwen / DeepSeek
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip Markdown JSON fences
  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  // Extract first { and last } to remove surrounding commentary
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.substring(start, end + 1);
  }

  return JSON.parse(text);
}

// ─── Gemini HTTP Caller ─────────────────────────────────────────
async function executeGeminiCall(
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string
): Promise<{ rawText: string; usage: TokenUsage; status: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const fullSystem = systemPrompt.includes('CRITICAL INSTRUCTION')
    ? systemPrompt
    : `${systemPrompt}\n\n${SCHEMA_INSTRUCTIONS}`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: fullSystem }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30_000),
  });
  // Safely parse response — Gemini sometimes returns HTML error pages on 502/503
  let data: any;
  try {
    data = await response.json();
  } catch {
    const rawText = await response.text().catch(() => '');
    const err = new Error(`Gemini returned non-JSON response [${response.status}]: ${rawText.slice(0, 200)}`);
    (err as any).status = response.status;
    throw err;
  }

  if (!response.ok) {
    const errorMsg = data?.error?.message || `HTTP ${response.status} ${response.statusText}`;

    // 429 rate limit: abort retry on this model immediately so caller cascades to next model
    if (response.status === 429) {
      const abortErr = new AbortError(`Gemini Rate Limited [429]: ${errorMsg}`);
      (abortErr as any).status = 429;
      throw abortErr;
    }

    // Non-retryable errors abort immediately
    if ([400, 401, 403, 404].includes(response.status)) {
      const abortErr = new AbortError(`Gemini Non-Retryable Error [${response.status}]: ${errorMsg}`);
      (abortErr as any).status = response.status;
      throw abortErr;
    }

    const err = new Error(`Gemini Transient Error [${response.status}]: ${errorMsg}`);
    (err as any).status = response.status;
    throw err;
  }

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Empty response from Gemini [${modelName}]`);
  }

  const meta = data.usageMetadata || {};
  const usage: TokenUsage = {
    promptTokens: meta.promptTokenCount || 0,
    completionTokens: meta.candidatesTokenCount || 0,
    totalTokens: meta.totalTokenCount || 0,
  };

  return { rawText, usage, status: response.status };
}

// ─── Singleton Groq Client (maxRetries: 0 to prevent retry compounding)
let cachedGroqClient: Groq | null = null;
function getGroqClient(apiKey: string): Groq {
  if (!cachedGroqClient) {
    cachedGroqClient = new Groq({ apiKey, maxRetries: 0, timeout: 30_000 });
  }
  return cachedGroqClient;
}

// ─── Groq HTTP Caller ───────────────────────────────────────────
async function executeGroqCall(
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  groqKey: string
): Promise<{ rawText: string; usage: TokenUsage; status: number }> {
  const groq = getGroqClient(groqKey);

  const fullSystem = systemPrompt.includes('CRITICAL INSTRUCTION')
    ? systemPrompt
    : `${systemPrompt}\n\n${SCHEMA_INSTRUCTIONS}`;

  try {
    const completion = await groq.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: fullSystem },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const rawText = completion.choices?.[0]?.message?.content || '{}';
    const usage: TokenUsage = {
      promptTokens: completion.usage?.prompt_tokens || 0,
      completionTokens: completion.usage?.completion_tokens || 0,
      totalTokens: completion.usage?.total_tokens || 0,
    };

    return { rawText, usage, status: 200 };
  } catch (err: any) {
    const status = err.status || err.statusCode;
    if (status && [400, 401, 403, 404].includes(status)) {
      const abortErr = new AbortError(`Groq Non-Retryable Error [${status}]: ${err.message}`);
      (abortErr as any).status = status;
      throw abortErr;
    }
    throw err;
  }
}

// ─── Single-Turn Schema Self-Repair ─────────────────────────────
async function callAndParseWithRepair<T>(
  caller: (sys: string, user: string) => Promise<{ rawText: string; usage: TokenUsage; status: number }>,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>
): Promise<{ data: T; usage: TokenUsage; wasRepaired: boolean }> {
  const firstAttempt = await caller(systemPrompt, userPrompt);

  try {
    const parsed = sanitizeAndParseJson(firstAttempt.rawText);
    const data = schema.parse(parsed);
    return { data, usage: firstAttempt.usage, wasRepaired: false };
  } catch (parseError: any) {
    // Single repair attempt with structured feedback
    const repairPrompt = `${userPrompt}\n\n[SCHEMA REPAIR NOTICE]: Your response was invalid.
Validation error: "${parseError.message}".
Please return valid JSON conforming to the schema.`;

    const secondAttempt = await caller(systemPrompt, repairPrompt);
    const parsed2 = sanitizeAndParseJson(secondAttempt.rawText);
    const data = schema.parse(parsed2);

    const totalUsage: TokenUsage = {
      promptTokens: firstAttempt.usage.promptTokens + secondAttempt.usage.promptTokens,
      completionTokens: firstAttempt.usage.completionTokens + secondAttempt.usage.completionTokens,
      totalTokens: firstAttempt.usage.totalTokens + secondAttempt.usage.totalTokens,
    };

    return { data, usage: totalUsage, wasRepaired: true };
  }
}

// ─── Main Production callModel Entry Point ──────────────────────
export async function callModel<T = AgentAction>(options: {
  systemPrompt: string;
  userPrompt: string;
  schema?: z.ZodSchema<T>;
  runId?: string;
  tracker?: RunTracker;
}): Promise<ModelCallResult<T>> {
  const { systemPrompt, userPrompt, schema = AgentActionSchema as unknown as z.ZodSchema<T>, tracker } = options;

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!geminiKey && !groqKey) {
    throw new Error('No LLM API keys configured. Set GEMINI_API_KEY or GROQ_API_KEY in .env');
  }

  const attempts: AttemptTrace[] = [];

  try {
    // 1. Gemini Cascade (4 verified fast models)
    if (geminiKey && !isBreakerOpen(geminiBreaker)) {
      let authFailed = false;

      for (const model of GEMINI_CASCADE) {
        const start = Date.now();
        try {
          const caller = (sys: string, usr: string) =>
            pRetry(() => executeGeminiCall(model, sys, usr, geminiKey), {
              retries: 1,
              factor: 2,
              minTimeout: 1000,
              maxTimeout: 3000,
            });

          const result = await callAndParseWithRepair(caller, systemPrompt, userPrompt, schema);

          const latencyMs = Date.now() - start;
          attempts.push({
            provider: 'gemini',
            model,
            status: result.wasRepaired ? 'repaired' : 'success',
            httpStatus: 200,
            latencyMs,
          });

          recordSuccess(geminiBreaker);

          const finalResult: ModelCallResult<T> = {
            data: result.data,
            usage: result.usage,
            model,
            provider: 'gemini',
            attempts,
          };

          if (tracker) {
            tracker.record(finalResult);
          }

          return finalResult;
        } catch (err: any) {
          const latencyMs = Date.now() - start;
          attempts.push({
            provider: 'gemini',
            model,
            status: 'error',
            httpStatus: err.status,
            latencyMs,
            error: err.message,
          });

          if (err.status === 401 || err.status === 403) {
            authFailed = true;
            recordFailure(geminiBreaker);
            break; // Stop immediately on bad auth
          }
        }
      }

      if (!authFailed) {
        recordFailure(geminiBreaker);
      }
    }

    // 2. Groq Multi-Model Fallback Cascade
    if (groqKey && !isBreakerOpen(groqBreaker)) {
      let authFailed = false;

      for (const model of GROQ_CASCADE) {
        const start = Date.now();
        try {
          const caller = (sys: string, usr: string) =>
            pRetry(() => executeGroqCall(model, sys, usr, groqKey), {
              retries: 1,
              minTimeout: 1000,
              maxTimeout: 2000,
            });

          const result = await callAndParseWithRepair(caller, systemPrompt, userPrompt, schema);

          const latencyMs = Date.now() - start;
          attempts.push({
            provider: 'groq',
            model,
            status: result.wasRepaired ? 'repaired' : 'success',
            httpStatus: 200,
            latencyMs,
          });

          recordSuccess(groqBreaker);

          const finalResult: ModelCallResult<T> = {
            data: result.data,
            usage: result.usage,
            model,
            provider: 'groq',
            attempts,
          };

          if (tracker) {
            tracker.record(finalResult);
          }

          return finalResult;
        } catch (err: any) {
          const latencyMs = Date.now() - start;
          attempts.push({
            provider: 'groq',
            model,
            status: 'error',
            httpStatus: err.status,
            latencyMs,
            error: err.message,
          });

          if (err.status === 401 || err.status === 403) {
            authFailed = true;
            recordFailure(groqBreaker);
            break;
          }
        }
      }

      if (!authFailed) {
        recordFailure(groqBreaker);
      }
    }

    const summary = attempts.map((a) => `${a.provider}:${a.model} (${a.error || a.status})`).join(' -> ');
    throw new Error(`All LLM providers failed in cascade. Trace: [${summary}]`);
  } catch (err) {
    if (tracker && attempts.length > 0) {
      tracker.recordFailedAttempts(attempts);
    }
    throw err;
  }
}

// Backward-compatible alias
export const callAgentModel = callModel;
