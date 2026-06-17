/**
 * lib/ai/provider.ts
 *
 * Thin server-side wrapper around the Anthropic SDK.
 * All AI calls for the project assistant go through here.
 *
 * Safety rules enforced at this layer:
 *  - ANTHROPIC_API_KEY is read from env; never logged or returned to client.
 *  - If the key is missing, completeWithProjectAi returns an error result.
 *  - Messages must be pre-redacted by the caller (via lib/ai/redaction.ts).
 *  - No shell commands are executed.  No file writes are performed.
 *
 * Model: uses ANTHROPIC_MODEL env var, defaults to claude-opus-4-8.
 * Streaming: NOT used here — the action layer returns the full text.
 * This keeps the server action boundary simple and avoids duplex streaming
 * complexity in Next.js App Router.
 */

import Anthropic from "@anthropic-ai/sdk";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCompletionResult {
  ok:    true;
  text:  string;
  model: string;
  inputTokens:  number;
  outputTokens: number;
}

export interface AiCompletionError {
  ok:    false;
  error: string;
  code?: "NO_API_KEY" | "RATE_LIMIT" | "OVERLOADED" | "API_ERROR";
}

export type AiResult = AiCompletionResult | AiCompletionError;

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MODEL    = "claude-opus-4-8";
const MAX_TOKENS       = 2048;
const MAX_INPUT_CHARS  = 120_000; // ~30K tokens — safe for 200K context window

// ── Provider ───────────────────────────────────────────────────────────────

/**
 * Call the Anthropic API with a project-context system prompt and
 * a conversation history.  Returns the full response text.
 *
 * Caller is responsible for:
 *  - Redacting secrets from systemPrompt and messages before calling.
 *  - Keeping message content within reasonable length limits.
 */
export async function completeWithProjectAi(
  systemPrompt: string,
  messages: AiMessage[],
): Promise<AiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok:    false,
      error: "ANTHROPIC_API_KEY is not configured. Add it to your .env file to use the AI assistant.",
      code:  "NO_API_KEY",
    };
  }

  const modelId = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  // Truncate very large inputs to avoid context overflow
  const truncatedSystem = systemPrompt.length > MAX_INPUT_CHARS
    ? systemPrompt.slice(0, MAX_INPUT_CHARS) + "\n\n[... context truncated ...]"
    : systemPrompt;

  const truncatedMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role:    m.role,
    content: m.content.length > 20_000
      ? m.content.slice(0, 20_000) + "\n\n[... truncated ...]"
      : m.content,
  }));

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model:      modelId,
      max_tokens: MAX_TOKENS,
      system:     truncatedSystem,
      messages:   truncatedMessages,
      thinking:   { type: "adaptive" },
    });

    // Extract the first text block
    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

    return {
      ok:           true,
      text,
      model:        response.model,
      inputTokens:  response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Rate limit reached. Please wait a moment and try again.", code: "RATE_LIMIT" };
    }
    if (err instanceof Anthropic.APIError) {
      // HTTP 529 = overloaded
      if (err.status === 529) {
        return { ok: false, error: "The AI service is temporarily overloaded. Please try again in a few seconds.", code: "OVERLOADED" };
      }
      return { ok: false, error: `AI API error (${err.status}): ${err.message}`, code: "API_ERROR" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Unexpected error: ${msg}`, code: "API_ERROR" };
  }
}
