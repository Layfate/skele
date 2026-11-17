// OpenRouter: hundreds of models (Claude, GPT, Gemini, Llama, DeepSeek, Qwen…) behind one API
// key, through its OpenAI-compatible Chat Completions endpoint. Plain fetch + SSE, so it works
// the same in the desktop app and the browser (OpenRouter allows cross-origin requests).

import { addUsage, joinRounds, MAX_TOOL_ROUNDS, noTooling, parseArgs, runTool, type ApiTooling } from "../tools";
import { EFFORTS, type Effort, type TurnUsage } from "../types";
import type { TurnHandlers, TurnMessage, TurnResult } from "./types";

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

/** Sent so the app shows up by name on the user's OpenRouter activity page. */
const APP_HEADERS = { "X-Title": "Skele" };

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number;
  /** Takes images as input. */
  vision: boolean;
  /** Accepts the `reasoning` parameter. */
  reasoning: boolean;
  /** Can call tools (function calling). */
  tools: boolean;
  /** Effort levels it accepts, when OpenRouter lists them (null: all). */
  efforts: string[] | null;
  /** USD per million tokens, when known. */
  promptPrice?: number;
  completionPrice?: number;
  free: boolean;
  created: number;
};

type RawModel = {
  id: string;
  canonical_slug?: string;
  name?: string;
  created?: number;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  reasoning?: { supported_efforts?: string[] | null } | null;
};

const perMillion = (s?: string) => (s && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) * 1e6 : undefined);

export function toModel(m: RawModel): OpenRouterModel {
  const promptPrice = perMillion(m.pricing?.prompt);
  const completionPrice = perMillion(m.pricing?.completion);
  return {
    id: m.id,
    name: m.name || m.id,
    contextLength: m.context_length || 32_000,
    vision: !!m.architecture?.input_modalities?.includes("image"),
    reasoning: !!m.supported_parameters?.includes("reasoning"),
    tools: !!m.supported_parameters?.includes("tools"),
    efforts: m.reasoning?.supported_efforts ?? null,
    promptPrice,
    completionPrice,
    free: m.id.endsWith(":free") || (promptPrice === 0 && completionPrice === 0),
    created: m.created ?? 0,
  };
}

let cache: { at: number; models: Promise<OpenRouterModel[]> } | null = null;

/** Display names by model id and canonical slug (what replies report), filled by the list. */
const names = new Map<string, string>();

/**
 * A model's readable name: "NVIDIA: Nemotron 3 Ultra (free)" from OpenRouter's list, or one
 * made from the id while the list hasn't loaded. `short` drops the "NVIDIA: " maker prefix.
 */
export function openRouterName(id: string, short = false): string {
  const free = id.endsWith(":free");
  const base = id.replace(/:free$/, "");
  let name = names.get(id) ?? names.get(base) ?? names.get(base.replace(/-\d{8}$/, ""));
  if (!name) {
    const slug = (base.split("/").pop() ?? base).replace(/-\d{8}$/, "");
    name = slug
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
    if (free) name += " (free)";
  } else if (free && !/\(free\)/i.test(name)) {
    name += " (free)";
  }
  return short ? name.replace(/^[^:]{1,40}:\s+/, "") : name;
}

/** Text-output models (the list is public; no key needed). Cached for an hour. */
export function listOpenRouterModels(force = false): Promise<OpenRouterModel[]> {
  if (!force && cache && Date.now() - cache.at < 60 * 60_000) return cache.models;
  const models = fetch(`${OPENROUTER_API}/models`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`OpenRouter answered ${r.status}`);
      const body = (await r.json()) as { data?: RawModel[] };
      return (body.data ?? [])
        .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes("text"))
        .map((raw) => {
          const m = toModel(raw);
          names.set(m.id, m.name);
          if (raw.canonical_slug) names.set(raw.canonical_slug, m.name);
          return m;
        })
        .sort((a, b) => b.created - a.created);
    })
    .catch((e) => {
      cache = null;
      throw e;
    });
  cache = { at: Date.now(), models };
  return models;
}

export async function openRouterModel(id: string): Promise<OpenRouterModel | undefined> {
  return (await listOpenRouterModels().catch(() => [])).find((m) => m.id === id);
}

export type OpenRouterKeyInfo = {
  label?: string;
  /** USD spent with this key: all time, today, this week, this month (UTC). */
  usage?: number;
  usageDaily?: number;
  usageWeekly?: number;
  usageMonthly?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  /** No credits bought yet: free models allow 50 requests a day instead of 1000. */
  freeTier?: boolean;
};

/** Free-model requests a day: 50 until credits have been bought, then 1000. */
export const freeDailyLimit = (freeTier: boolean | undefined) => (freeTier ? 50 : 1000);

/** Credits on the account (USD): bought and used. Null when OpenRouter doesn't say. */
export async function openRouterCredits(apiKey: string): Promise<{ total: number; used: number } | null> {
  const r = await fetch(`${OPENROUTER_API}/credits`, { headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => null);
  if (!r?.ok) return null;
  const d = ((await r.json().catch(() => ({}))) as { data?: { total_credits?: number; total_usage?: number } }).data;
  return typeof d?.total_credits === "number" ? { total: d.total_credits, used: d.total_usage ?? 0 } : null;
}

/** Checks a key and reads its spend and limit. */
export async function checkOpenRouterKey(apiKey: string): Promise<OpenRouterKeyInfo> {
  const r = await fetch(`${OPENROUTER_API}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (r.status === 401) throw new Error("OpenRouter rejected this key.");
  if (!r.ok) throw new Error(`OpenRouter answered ${r.status}.`);
  const d = ((await r.json()) as { data?: Record<string, unknown> }).data ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    label: typeof d.label === "string" ? d.label : undefined,
    usage: num(d.usage) ?? undefined,
    usageDaily: num(d.usage_daily) ?? undefined,
    usageWeekly: num(d.usage_weekly) ?? undefined,
    usageMonthly: num(d.usage_monthly) ?? undefined,
    limit: num(d.limit),
    limitRemaining: num(d.limit_remaining),
    freeTier: d.is_free_tier === true,
  };
}

/** The effort to send: the chosen one, or the nearest lower level the model accepts. */
export function openRouterEffort(effort: Effort, efforts: string[] | null): string {
  if (!efforts?.length) return effort;
  const order = ["minimal", ...EFFORTS.map((e) => e.id)];
  for (let i = order.indexOf(effort); i >= 0; i--) if (efforts.includes(order[i])) return order[i];
  return efforts.find((e) => e !== "none") ?? effort;
}

type Delta = {
  content?: string | null;
  reasoning?: string | null;
  reasoning_details?: { type?: string; text?: string; summary?: string }[];
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
};

export type ToolCall = { id: string; name: string; arguments: string };
type Chunk = {
  model?: string;
  choices?: { delta?: Delta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number };
  error?: { message?: string; code?: number | string };
};

/** Reads one SSE stream of Chat Completions chunks. Exported for tests. */
export function openRouterParser(on: TurnHandlers) {
  let buffer = "";
  const state = {
    text: "",
    thinking: "",
    model: undefined as string | undefined,
    usage: undefined as Chunk["usage"],
    finish: undefined as string | undefined,
    error: undefined as string | undefined,
    /** Tool calls, put together from their streamed pieces (by index). */
    toolCalls: [] as ToolCall[],
  };
  const line = (raw: string) => {
    const l = raw.trim();
    // ": OPENROUTER PROCESSING" keep-alives and blank lines.
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      return;
    }
    if (chunk.error) state.error = chunk.error.message || `Error ${chunk.error.code ?? ""}`.trim();
    if (chunk.model) state.model = chunk.model;
    if (chunk.usage) state.usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const d = choice.delta ?? {};
      const thought =
        d.reasoning ||
        (d.reasoning_details ?? [])
          .map((r) => (r.type === "reasoning.text" ? r.text : r.type === "reasoning.summary" ? r.summary : "") ?? "")
          .join("");
      if (thought) {
        state.thinking += thought;
        on.thinking(state.thinking);
      }
      if (d.content) {
        state.text += d.content;
        on.text(state.text);
      }
      for (const t of d.tool_calls ?? []) {
        const i = t.index ?? state.toolCalls.length;
        const call = (state.toolCalls[i] ??= { id: "", name: "", arguments: "" });
        if (t.id) call.id = t.id;
        if (t.function?.name) call.name += t.function.name;
        if (t.function?.arguments) call.arguments += t.function.arguments;
      }
      if (choice.finish_reason) state.finish = choice.finish_reason;
    }
  };
  return {
    state,
    push(text: string) {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(line);
    },
    end() {
      if (buffer) line(buffer);
      buffer = "";
    },
  };
}

export async function streamOpenRouter(input: {
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
  if (!input.model) return { text: "", error: "Choose an OpenRouter model first (Settings → AI → Providers)." };
  const meta = await openRouterModel(input.model);
  const vision = meta?.vision ?? true;
  let tooling = input.tooling ?? noTooling;
  const activity: string[] = [];
  const note = (line: string) => {
    activity.push(line);
    input.on.activity(line);
  };
  if (tooling.tools.length && meta && !meta.tools) {
    note(`${meta.name} can't use tools, so it answers without your files or MCP servers.`);
    tooling = { ...tooling, tools: [] };
  }
  const messages: Record<string, unknown>[] = [
    { role: "system", content: input.system },
    ...input.messages.map((m) =>
      m.role === "user" && m.images?.length && vision
        ? {
            role: "user",
            content: [
              { type: "text", text: m.content || "(image)" },
              ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.data}` } })),
            ],
          }
        : { role: m.role, content: m.images?.length && !vision ? `${m.content}\n\n[An image was attached, but this model can't see images.]` : m.content },
    ),
  ];
  const base: Record<string, unknown> = { model: input.model, stream: true, stream_options: { include_usage: true } };
  if (meta?.reasoning) base.reasoning = { effort: openRouterEffort(input.effort, meta.efforts), exclude: !input.showThinking };
  if (tooling.tools.length) {
    base.tools = tooling.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }
  // OpenRouter's web plugin: searches before answering (billed by OpenRouter per result).
  if (tooling.web) base.plugins = [{ id: "web" }];

  // Text and reasoning from earlier rounds of tool calls, shown above the current round's.
  let text = "";
  let thinking = "";
  let usage: TurnUsage | undefined;
  let modelId: string | undefined;
  const result = (extra: Partial<TurnResult> = {}): TurnResult => ({
    text,
    thinking: thinking || undefined,
    activity: activity.length ? activity : undefined,
    modelId,
    usage,
    ...extra,
  });
  try {
    for (let round = 0; ; round++) {
      const before = { text, thinking };
      const parser = openRouterParser({
        ...input.on,
        text: (t) => input.on.text(joinRounds(before.text, t)),
        thinking: (t) => input.on.thinking(joinRounds(before.thinking, t)),
      });
      const s = parser.state;
      const r = await fetch(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json", ...APP_HEADERS },
        body: JSON.stringify({ ...base, messages }),
        signal: input.signal,
      });
      if (!r.ok || !r.body) return result({ error: openRouterError(r.status, await r.text().catch(() => "")) });
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.end();
      text = joinRounds(before.text, s.text);
      thinking = joinRounds(before.thinking, s.thinking);
      modelId = s.model ?? modelId;
      if (s.usage) {
        usage = addUsage(usage, {
          inputTokens: s.usage.prompt_tokens ?? 0,
          outputTokens: s.usage.completion_tokens ?? 0,
          cachedTokens: s.usage.prompt_tokens_details?.cached_tokens || undefined,
          costUsd: s.usage.cost || undefined,
        });
      }
      if (s.error) return result({ error: `OpenRouter: ${s.error}` });
      const calls = s.toolCalls.filter((c) => c && c.name);
      if (s.finish === "length") return result({ error: "The reply was cut off (max tokens)." });
      if (!calls.length || !tooling.tools.length) return result();
      if (round + 1 >= MAX_TOOL_ROUNDS) return result({ error: `Stopped after ${MAX_TOOL_ROUNDS} rounds of tool calls.` });
      calls.forEach((c, i) => (c.id ||= `call_${round}_${i}`));
      messages.push({
        role: "assistant",
        content: s.text || "",
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
      });
      for (const c of calls) {
        const out = await runTool(tooling, c.name, parseArgs(c.arguments), note);
        messages.push({ role: "tool", tool_call_id: c.id, content: out.isError ? `Error: ${out.text}` : out.text });
        if (input.signal.aborted) return result({ stopped: true });
      }
    }
  } catch (error) {
    if (input.signal.aborted) return result({ stopped: true });
    const msg = error instanceof Error ? error.message : String(error);
    return result({ error: /fetch|network|load failed/i.test(msg) ? "Couldn't reach OpenRouter. Check your internet connection." : msg });
  }
}

/** A readable error for a failed request (OpenRouter sends `{ error: { message } }`). */
export function openRouterError(status: number, body: string): string {
  let message = "";
  try {
    message = (JSON.parse(body) as Chunk).error?.message ?? "";
  } catch {
    message = body.slice(0, 300);
  }
  switch (status) {
    case 401:
      return "Your OpenRouter API key was rejected. Check it in Settings → AI.";
    case 402:
      return "Your OpenRouter account is out of credits. Add credits at openrouter.ai/settings/credits.";
    case 404:
      return `That model isn't available on OpenRouter${message ? `: ${message}` : "."}`;
    case 429:
      return "Rate limited by OpenRouter. Wait a moment and try again.";
    default:
      return `OpenRouter error ${status}${message ? `: ${message}` : ""}`;
  }
}

/** "$3 / $15 per M" for a model menu hint. */
export function priceHint(m: OpenRouterModel): string {
  if (m.free) return "Free";
  if (m.promptPrice === undefined || m.completionPrice === undefined) return "";
  const f = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(2).replace(/\.?0+$/, "") : n.toFixed(3).replace(/\.?0+$/, ""));
  return `$${f(m.promptPrice)} in / $${f(m.completionPrice)} out per M tokens`;
}
