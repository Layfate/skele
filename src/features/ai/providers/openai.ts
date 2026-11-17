// Codex / GPT models through the OpenAI API with the user's own key (Responses API).

import OpenAI from "openai";
import { addUsage, joinRounds, MAX_TOOL_ROUNDS, noTooling, parseArgs, runTool, type ApiTooling } from "../tools";
import { effortFor, type Effort, type TurnUsage } from "../types";
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
  /** File, MCP and web tools for this turn (see ../tools.ts). */
  tooling?: ApiTooling;
}): Promise<TurnResult> {
  if (!input.model) return { text: "", error: "Choose an OpenAI model first." };
  const client = new OpenAI({ apiKey: input.apiKey, dangerouslyAllowBrowser: true });
  const tooling = input.tooling ?? noTooling;
  const tools: OpenAI.Responses.Tool[] = [
    ...tooling.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false })),
    ...(tooling.web ? [{ type: "web_search" as const }] : []),
  ];
  const activity: string[] = [];
  const note = (line: string) => {
    activity.push(line);
    input.on.activity(line);
  };
  let text = "";
  let thinking = "";
  let usage: TurnUsage | undefined;
  const result = (extra: Partial<TurnResult> = {}): TurnResult => ({ text, thinking, usage, activity: activity.length ? activity : undefined, ...extra });
  // The first request sends the conversation; later rounds send only the tool outputs and
  // continue from the previous response (kept by OpenAI for that).
  let next: OpenAI.Responses.ResponseInput = input.messages.map((m) =>
    m.role === "user" && m.images?.length
      ? {
          role: "user" as const,
          content: [
            ...m.images.map((i) => ({ type: "input_image" as const, image_url: `data:${i.mediaType};base64,${i.data}`, detail: "auto" as const })),
            { type: "input_text" as const, text: m.content || "(image)" },
          ],
        }
      : { role: m.role, content: m.content },
  );
  let previous: string | undefined;
  try {
    for (let round = 0; ; round++) {
      const before = { text, thinking };
      let roundText = "";
      let roundThinking = "";
      const stream = client.responses.stream(
        {
          model: input.model,
          instructions: input.system,
          input: next,
          ...(previous ? { previous_response_id: previous } : {}),
          ...(tools.length ? { tools } : {}),
          ...(isReasoningModel(input.model)
            ? { reasoning: { effort: effortFor("openai", input.effort) as "low" | "medium" | "high", ...(input.showThinking ? { summary: "auto" as const } : {}) } }
            : {}),
        },
        { signal: input.signal },
      );
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          roundText += event.delta;
          input.on.text(joinRounds(before.text, roundText));
        } else if (event.type === "response.reasoning_summary_text.delta") {
          roundThinking += event.delta;
          input.on.thinking(joinRounds(before.thinking, roundThinking));
        }
      }
      const final = await stream.finalResponse();
      text = joinRounds(before.text, roundText);
      thinking = joinRounds(before.thinking, roundThinking);
      if (final.usage) {
        usage = addUsage(usage, {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
          cachedTokens: final.usage.input_tokens_details?.cached_tokens || undefined,
        });
      }
      for (const item of final.output) {
        if (item.type === "web_search_call") {
          const q = (item as { action?: { query?: string } }).action?.query;
          note(q ? `Searched the web for “${q}”` : "Searched the web");
        }
      }
      if (final.status === "incomplete") {
        return result({ error: `The reply was cut off (${final.incomplete_details?.reason ?? "incomplete"}).` });
      }
      const calls = final.output.flatMap((o) => (o.type === "function_call" ? [o] : []));
      if (!calls.length || !tooling.tools.length) return result();
      if (round + 1 >= MAX_TOOL_ROUNDS) return result({ error: `Stopped after ${MAX_TOOL_ROUNDS} rounds of tool calls.` });
      const outputs: OpenAI.Responses.ResponseInput = [];
      for (const c of calls) {
        const out = await runTool(tooling, c.name, parseArgs(c.arguments), note);
        outputs.push({ type: "function_call_output", call_id: c.call_id, output: out.isError ? `Error: ${out.text}` : out.text });
        if (input.signal.aborted) return result({ stopped: true });
      }
      previous = final.id;
      next = outputs;
    }
  } catch (error) {
    if (error instanceof OpenAI.APIUserAbortError || input.signal.aborted) return result({ stopped: true });
    return result({ error: openaiError(error) });
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
