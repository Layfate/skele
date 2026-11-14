// Claude through the Claude API with the user's own key. Skele is local-first and has no
// server, so the request goes straight from this device to api.anthropic.com.

import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../types";
import type { TurnHandlers, TurnMessage, TurnResult } from "./types";

// Models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"]);

export async function streamAnthropic(input: {
  apiKey: string;
  model: string;
  effort: Effort;
  system: string;
  messages: TurnMessage[];
  showThinking: boolean;
  signal: AbortSignal;
  on: TurnHandlers;
}): Promise<TurnResult> {
  const client = new Anthropic({ apiKey: input.apiKey, dangerouslyAllowBrowser: true });
  let text = "";
  let thinking = "";
  try {
    const stream = client.beta.messages.stream(
      {
        model: input.model,
        max_tokens: 64000,
        system: input.system,
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        thinking: { type: "adaptive", display: input.showThinking ? "summarized" : "omitted" },
        output_config: { effort: input.effort },
        ...(FALLBACK_MODELS.has(input.model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      },
      { signal: input.signal },
    );
    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") {
        text += event.delta.text;
        input.on.text(text);
      } else if (event.delta.type === "thinking_delta") {
        thinking += event.delta.thinking;
        input.on.thinking(thinking);
      }
    }
    const final = await stream.finalMessage();
    const u = final.usage;
    const usage = {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      cachedTokens: u.cache_read_input_tokens || undefined,
    };
    if (final.stop_reason === "refusal") {
      const why = final.stop_details?.explanation;
      return { text, thinking, usage, error: `Claude declined to answer this.${why ? ` ${why}` : ""}` };
    }
    if (final.stop_reason === "max_tokens") {
      return { text, thinking, usage, error: "The reply hit the length limit and was cut off." };
    }
    return { text, thinking, usage };
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || input.signal.aborted) return { text, thinking, stopped: true };
    return { text, thinking, error: anthropicError(error) };
  }
}

function anthropicError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Your Anthropic API key was rejected. Check it in Settings → AI.";
  if (error instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to that model.";
  if (error instanceof Anthropic.NotFoundError) return "That model isn't available for this API key.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API. Wait a moment and try again.";
  if (error instanceof Anthropic.BadRequestError) return `The Claude API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your internet connection.";
  if (error instanceof Anthropic.APIError) return `Claude API error${error.status ? ` ${error.status}` : ""}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
