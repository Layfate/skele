// Claude through the Claude API with the user's own key. Skele is local-first and has no
// server, so the request goes straight from this device to api.anthropic.com.

import Anthropic from "@anthropic-ai/sdk";
import { addUsage, joinRounds, MAX_TOOL_ROUNDS, noTooling, runTool, type ApiTooling } from "../tools";
import type { Effort, TurnUsage } from "../types";
import type { TurnHandlers, TurnMessage, TurnResult } from "./types";

/** A message for the API: text, plus image blocks before it when the message has images. */
function toParam(m: TurnMessage): Anthropic.Beta.BetaMessageParam {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      ...m.images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.data } })),
      { type: "text" as const, text: m.content || "(image)" },
    ],
  };
}

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
  /** File, MCP and web tools for this turn (see ../tools.ts). */
  tooling?: ApiTooling;
}): Promise<TurnResult> {
  const client = new Anthropic({ apiKey: input.apiKey, dangerouslyAllowBrowser: true });
  const tooling = input.tooling ?? noTooling;
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    ...tooling.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
      // Large inputs (a whole file for write_file) stream as they're written; runTool checks
      // each input against its schema before running it.
      eager_input_streaming: true,
    })),
    ...(tooling.web ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 5 }] : []),
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = input.messages.map(toParam);
  const activity: string[] = [];
  const note = (line: string) => {
    activity.push(line);
    input.on.activity(line);
  };
  let text = "";
  let thinking = "";
  let usage: TurnUsage | undefined;
  let jsonRetries = 0;
  const result = (extra: Partial<TurnResult> = {}): TurnResult => ({ text, thinking, usage, activity: activity.length ? activity : undefined, ...extra });
  try {
    for (let round = 0; ; round++) {
      const before = { text, thinking };
      let roundText = "";
      let roundThinking = "";
      const stream = client.beta.messages.stream(
        {
          model: input.model,
          max_tokens: 64000,
          system: input.system,
          messages,
          ...(tools.length ? { tools } : {}),
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
          roundText += event.delta.text;
          input.on.text(joinRounds(before.text, roundText));
        } else if (event.delta.type === "thinking_delta") {
          roundThinking += event.delta.thinking;
          input.on.thinking(joinRounds(before.thinking, roundThinking));
        }
      }
      let final: Anthropic.Beta.BetaMessage;
      try {
        final = await stream.finalMessage();
        jsonRetries = 0;
      } catch (error) {
        // With eager input streaming, a tool input that isn't JSON at all rejects here;
        // ask again (twice at most). API errors go to the outer handler.
        if (error instanceof Anthropic.APIError || input.signal.aborted || jsonRetries++ >= 2) throw error;
        continue;
      }
      text = joinRounds(before.text, roundText);
      thinking = joinRounds(before.thinking, roundThinking);
      const u = final.usage;
      usage = addUsage(usage, {
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        cachedTokens: u.cache_read_input_tokens || undefined,
      });
      for (const b of final.content) {
        if (b.type === "server_tool_use" && b.name === "web_search") {
          const q = (b.input as { query?: string } | null)?.query;
          note(q ? `Searched the web for “${q}”` : "Searched the web");
        }
      }
      if (final.stop_reason === "refusal") {
        const why = final.stop_details?.explanation;
        return result({ error: `Claude declined to answer this.${why ? ` ${why}` : ""}` });
      }
      if (final.stop_reason === "max_tokens") return result({ error: "The reply hit the length limit and was cut off." });
      if (final.stop_reason === "pause_turn") {
        // A long server-tool turn (web search) paused: send it back so the server continues.
        messages.push({ role: "assistant", content: final.content });
        continue;
      }
      const calls = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (final.stop_reason !== "tool_use" || !calls.length) return result();
      if (round + 1 >= MAX_TOOL_ROUNDS) return result({ error: `Stopped after ${MAX_TOOL_ROUNDS} rounds of tool calls.` });
      // The whole assistant turn goes back unchanged (thinking blocks included).
      messages.push({ role: "assistant", content: final.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const c of calls) {
        const out = await runTool(tooling, c.name, c.input, note);
        results.push({ type: "tool_result", tool_use_id: c.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
        if (input.signal.aborted) return result({ stopped: true });
      }
      // Every result of a turn in one message.
      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || input.signal.aborted) return result({ stopped: true });
    return result({ error: anthropicError(error) });
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
