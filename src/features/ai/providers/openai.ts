// Codex / GPT models through the OpenAI API with the user's own key (Responses API).

import OpenAI from "openai";
import { effortFor, type Effort } from "../types";
import type { TurnHandlers, TurnMessage, TurnResult } from "./types";

// Reasoning models take `reasoning`; older chat models reject it.
const isReasoningModel = (model: string) => /codex|^o\d|^gpt-[5-9]/i.test(model);

export async function streamOpenAI(input: {
  apiKey: string;
  model: string;
  effort: Effort;
  system: string;
  messages: TurnMessage[];
  showThinking: boolean;
  signal: AbortSignal;
  on: TurnHandlers;
}): Promise<TurnResult> {
  if (!input.model) return { text: "", error: "Choose an OpenAI model first." };
  const client = new OpenAI({ apiKey: input.apiKey, dangerouslyAllowBrowser: true });
  let text = "";
  let thinking = "";
  try {
    const stream = client.responses.stream(
      {
        model: input.model,
        instructions: input.system,
        input: input.messages.map((m) =>
          m.role === "user" && m.images?.length
            ? {
                role: "user" as const,
                content: [
                  ...m.images.map((i) => ({ type: "input_image" as const, image_url: `data:${i.mediaType};base64,${i.data}`, detail: "auto" as const })),
                  { type: "input_text" as const, text: m.content || "(image)" },
                ],
              }
            : { role: m.role, content: m.content },
        ),
        ...(isReasoningModel(input.model)
          ? { reasoning: { effort: effortFor("openai", input.effort) as "low" | "medium" | "high", ...(input.showThinking ? { summary: "auto" as const } : {}) } }
          : {}),
      },
      { signal: input.signal },
    );
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        text += event.delta;
        input.on.text(text);
      } else if (event.type === "response.reasoning_summary_text.delta") {
        thinking += event.delta;
        input.on.thinking(thinking);
      }
    }
    const final = await stream.finalResponse();
    const usage = final.usage
      ? {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
          cachedTokens: final.usage.input_tokens_details?.cached_tokens || undefined,
        }
      : undefined;
    if (final.status === "incomplete") {
      return { text, thinking, usage, error: `The reply was cut off (${final.incomplete_details?.reason ?? "incomplete"}).` };
    }
    return { text, thinking, usage };
  } catch (error) {
    if (error instanceof OpenAI.APIUserAbortError || input.signal.aborted) return { text, thinking, stopped: true };
    return { text, thinking, error: openaiError(error) };
  }
}

function openaiError(error: unknown): string {
  if (error instanceof OpenAI.AuthenticationError) return "Your OpenAI API key was rejected. Check it in Settings → AI.";
  if (error instanceof OpenAI.NotFoundError) return "That model isn't available for this API key.";
  if (error instanceof OpenAI.RateLimitError) return "Rate limited by the OpenAI API. Wait a moment and try again.";
  if (error instanceof OpenAI.APIConnectionError) return "Couldn't reach the OpenAI API. Check your internet connection.";
  if (error instanceof OpenAI.APIError) return `OpenAI API error${error.status ? ` ${error.status}` : ""}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Chat-capable models on this key, newest-looking first. */
export async function listOpenAIModels(apiKey: string): Promise<string[]> {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  const ids: string[] = [];
  for await (const model of client.models.list()) ids.push(model.id);
  return ids
    .filter((id) => /codex|gpt|^o\d/i.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding/i.test(id))
    .sort((a, b) => Number(/codex/i.test(b)) - Number(/codex/i.test(a)) || b.localeCompare(a, undefined, { numeric: true }));
}
