// OpenRouter: model list mapping, effort mapping, the SSE parser, and a full streamed reply
// against a stubbed fetch (no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { openRouterEffort, openRouterError, openRouterParser, priceHint, streamOpenRouter, toModel } from "@/features/ai/providers/openrouter";
import { contextBudget } from "@/features/ai/context";
import { DEFAULT_AI_SETTINGS, effortFor } from "@/features/ai/types";
import { providerAvailable } from "@/features/ai/run";
import type { TurnHandlers } from "@/features/ai/providers/types";

const handlers = (): TurnHandlers & { texts: string[]; thoughts: string[] } => {
  const texts: string[] = [];
  const thoughts: string[] = [];
  return { texts, thoughts, text: (t) => texts.push(t), thinking: (t) => thoughts.push(t), activity: () => {}, session: () => {} };
};

const sse = (...events: unknown[]) => events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}`)).join("\n\n") + "\n\n";

const MODELS = {
  data: [
    {
      id: "acme/thinker",
      name: "Acme: Thinker",
      created: 2,
      context_length: 200_000,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["reasoning", "max_tokens"],
      reasoning: { supported_efforts: ["low", "medium", "high"] },
    },
    { id: "acme/tiny:free", name: "Acme: Tiny (free)", created: 1, context_length: 8192, architecture: { input_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } },
    { id: "acme/painter", name: "Painter", created: 3, architecture: { output_modalities: ["image"] } },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter", () => {
  it("maps the model list: vision, reasoning, prices, free models", () => {
    const m = toModel(MODELS.data[0]);
    expect(m).toMatchObject({ id: "acme/thinker", contextLength: 200_000, vision: true, reasoning: true, efforts: ["low", "medium", "high"], free: false });
    expect(priceHint(m)).toBe("$3 in / $15 out per M tokens");
    const free = toModel(MODELS.data[1]);
    expect(free).toMatchObject({ vision: false, reasoning: false, free: true });
    expect(priceHint(free)).toBe("Free");
  });

  it("lowers effort to what the model accepts", () => {
    expect(effortFor("openrouter", "max")).toBe("max");
    expect(openRouterEffort("max", null)).toBe("max");
    expect(openRouterEffort("max", ["low", "medium", "high"])).toBe("high");
    expect(openRouterEffort("low", ["high"])).toBe("high");
  });

  it("parses streamed text, reasoning (both shapes), usage and keep-alives", () => {
    const on = handlers();
    const p = openRouterParser(on);
    const body = sse(
      ": OPENROUTER PROCESSING",
      { model: "acme/thinker-2026", choices: [{ delta: { reasoning: "Hmm, " } }] },
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "let me think." }] } }] },
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0004 } },
      "data: [DONE]",
    );
    // Split mid-line to check buffering.
    p.push(body.slice(0, 57));
    p.push(body.slice(57));
    p.end();
    expect(p.state.text).toBe("Hello");
    expect(p.state.thinking).toBe("Hmm, let me think.");
    expect(p.state.model).toBe("acme/thinker-2026");
    expect(p.state.finish).toBe("stop");
    expect(p.state.usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 3 });
    expect(on.texts.at(-1)).toBe("Hello");
  });

  it("explains HTTP errors", () => {
    expect(openRouterError(401, "")).toMatch(/key was rejected/);
    expect(openRouterError(402, "")).toMatch(/out of credits/);
    expect(openRouterError(500, JSON.stringify({ error: { message: "Upstream down" } }))).toBe("OpenRouter error 500: Upstream down");
  });

  it("budgets context from the model's window, and needs only a key", () => {
    expect(contextBudget("openrouter", { ...DEFAULT_AI_SETTINGS, openrouterContext: 8192 })).toBe(5844);
    expect(contextBudget("openrouter", { ...DEFAULT_AI_SETTINGS, openrouterContext: 2_000_000 })).toBe(150_000);
    expect(providerAvailable("openrouter", DEFAULT_AI_SETTINGS)).toBe(false);
    expect(providerAvailable("openrouter", { ...DEFAULT_AI_SETTINGS, openrouterKey: "sk-or-x" })).toBe(true);
  });

  it("streams a reply: sends images and reasoning for models that take them", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/models")) return new Response(JSON.stringify(MODELS));
        return new Response(
          sse({ choices: [{ delta: { content: "Hi there" }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.01 } }, "data: [DONE]"),
        );
      }),
    );
    const on = handlers();
    const r = await streamOpenRouter({
      apiKey: "sk-or-test",
      model: "acme/thinker",
      effort: "max",
      system: "Be brief.",
      messages: [{ role: "user", content: "What's this?", images: [{ mediaType: "image/png", data: "AAAA" }] }],
      showThinking: false,
      signal: new AbortController().signal,
      on,
    });
    expect(r).toMatchObject({ text: "Hi there", usage: { inputTokens: 5, outputTokens: 2, costUsd: 0.01 } });
    expect(r.error).toBeUndefined();
    const chat = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect((chat.init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    const body = JSON.parse(chat.init!.body as string);
    expect(body.model).toBe("acme/thinker");
    expect(body.stream).toBe(true);
    expect(body.reasoning).toEqual({ effort: "high", exclude: true });
    expect(body.messages[0]).toEqual({ role: "system", content: "Be brief." });
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  });

  it("returns a readable error when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/models") ? new Response(JSON.stringify({ data: [] })) : new Response(JSON.stringify({ error: { message: "No credits" } }), { status: 402 }),
      ),
    );
    const r = await streamOpenRouter({
      apiKey: "k",
      model: "acme/other",
      effort: "low",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      showThinking: true,
      signal: new AbortController().signal,
      on: handlers(),
    });
    expect(r.error).toMatch(/out of credits/);
  });
});
