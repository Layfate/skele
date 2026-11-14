// Local models through Ollama. In the desktop app requests go through the Rust side
// (src-tauri/src/ai_ollama.rs), so no network exception or CORS setup is needed; in a browser
// they go straight to the Ollama server (which must allow this site in OLLAMA_ORIGINS unless
// it's served from localhost).

import { newId } from "@/data/common";
import { isDesktop } from "@/lib/desktop";
import type { TurnUsage } from "../types";
import { tauri } from "./cli";
import type { TurnHandlers, TurnMessage, TurnResult } from "./types";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

export type OllamaModel = {
  name: string;
  size?: number;
  modified_at?: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
};

export type OllamaStatus = { binary: string | null; running: boolean; version: string | null; url: string };

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

const clean = (url: string) => (url.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");

/** Parses Ollama's `/api/chat` NDJSON stream. */
export function ollamaParser(on: TurnHandlers) {
  const state = { text: "", thinking: "", error: "", done: false, usage: undefined as TurnUsage | undefined };
  return {
    state,
    line(event: Json) {
      if (typeof event.error === "string") {
        state.error = event.error;
        return;
      }
      const msg = (event.message ?? {}) as Json;
      if (str(msg.thinking)) {
        state.thinking += str(msg.thinking);
        on.thinking(state.thinking);
      }
      if (str(msg.content)) {
        state.text += str(msg.content);
        on.text(state.text);
      }
      if (event.done) {
        state.done = true;
        state.usage = {
          inputTokens: typeof event.prompt_eval_count === "number" ? event.prompt_eval_count : 0,
          outputTokens: typeof event.eval_count === "number" ? event.eval_count : 0,
        };
      }
    },
  };
}

/** Splits a streamed body into lines and hands each to `onLine`. */
async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  }
  if (buf.trim()) onLine(buf.trim());
}

function browserError(e: unknown, url: string) {
  if (e instanceof DOMException && e.name === "AbortError") return null;
  return `Couldn't reach Ollama at ${url}. Make sure Ollama is running${
    typeof window !== "undefined" && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
      ? ` and allows this site (set OLLAMA_ORIGINS=${window.location.origin})`
      : ""
  }.`;
}

export async function ollamaStatus(url: string, path?: string): Promise<OllamaStatus> {
  if (isDesktop()) {
    const { invoke } = await tauri();
    return invoke<OllamaStatus>("ai_ollama_status", { url: clean(url), path: path || null });
  }
  try {
    const r = await fetch(`${clean(url)}/api/version`, { signal: AbortSignal.timeout(4000) });
    const v = r.ok ? ((await r.json()) as Json) : null;
    return { binary: null, running: !!v, version: v ? str(v.version) : null, url: clean(url) };
  } catch {
    return { binary: null, running: false, version: null, url: clean(url) };
  }
}

export async function listOllamaModels(url: string): Promise<OllamaModel[]> {
  if (isDesktop()) {
    const { invoke } = await tauri();
    return (await invoke<OllamaModel[] | null>("ai_ollama_models", { url: clean(url) })) ?? [];
  }
  const r = await fetch(`${clean(url)}/api/tags`).catch((e) => {
    throw new Error(browserError(e, clean(url)) ?? "Cancelled");
  });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
  return (((await r.json()) as Json).models as OllamaModel[] | undefined) ?? [];
}

export async function startOllama(path?: string) {
  const { invoke } = await tauri();
  await invoke("ai_ollama_start", { path: path || null });
}

export async function deleteOllamaModel(url: string, model: string) {
  if (isDesktop()) {
    const { invoke } = await tauri();
    return invoke("ai_ollama_delete", { url: clean(url), model });
  }
  const r = await fetch(`${clean(url)}/api/delete`, { method: "DELETE", body: JSON.stringify({ model }) });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
}

/** Progress of a model download: status text and 0..1 when known. */
export type PullProgress = { status: string; fraction?: number };

export async function pullOllamaModel(url: string, model: string, onProgress: (p: PullProgress) => void, signal: AbortSignal) {
  let error = "";
  const onLine = (line: string) => {
    try {
      const e = JSON.parse(line) as Json;
      if (typeof e.error === "string") error = e.error;
      const total = typeof e.total === "number" ? e.total : 0;
      const done = typeof e.completed === "number" ? e.completed : 0;
      onProgress({ status: str(e.status), fraction: total ? done / total : undefined });
    } catch {
      // ignore partial lines
    }
  };
  if (isDesktop()) {
    const { Channel, invoke } = await tauri();
    const runId = newId();
    const channel = new Channel<string>();
    channel.onmessage = onLine;
    const cancel = () => void invoke("ai_ollama_cancel", { runId }).catch(() => {});
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await invoke("ai_ollama_pull", { runId, url: clean(url), model, onEvent: channel });
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  } else {
    const r = await fetch(`${clean(url)}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }), signal });
    if (!r.ok || !r.body) throw new Error(`Ollama answered ${r.status}`);
    await readLines(r.body, onLine);
  }
  if (error) throw new Error(error);
}

export async function streamOllama(input: {
  url: string;
  model: string;
  system: string;
  messages: TurnMessage[];
  numCtx: number;
  showThinking: boolean;
  signal: AbortSignal;
  on: TurnHandlers;
}): Promise<TurnResult> {
  if (!input.model) return { text: "", error: "Choose an Ollama model first (Settings → AI → Local models)." };
  const parser = ollamaParser(input.on);
  const messages = [{ role: "system", content: input.system }, ...input.messages];
  const result = (): TurnResult => ({ text: parser.state.text, thinking: parser.state.thinking, usage: parser.state.usage });
  const onLine = (line: string) => {
    try {
      parser.line(JSON.parse(line) as Json);
    } catch {
      // ignore partial lines
    }
  };
  if (input.signal.aborted) return { text: "", stopped: true };
  try {
    if (isDesktop()) {
      const { Channel, invoke } = await tauri();
      const runId = newId();
      const channel = new Channel<string>();
      channel.onmessage = onLine;
      const cancel = () => void invoke("ai_ollama_cancel", { runId }).catch(() => {});
      input.signal.addEventListener("abort", cancel, { once: true });
      try {
        const r = await invoke<{ cancelled: boolean }>("ai_ollama_chat", {
          args: { runId, url: clean(input.url), model: input.model, messages, numCtx: input.numCtx, think: input.showThinking ? undefined : false },
          onEvent: channel,
        });
        if (r.cancelled || input.signal.aborted) return { ...result(), stopped: true };
      } finally {
        input.signal.removeEventListener("abort", cancel);
      }
    } else {
      const r = await fetch(`${clean(input.url)}/api/chat`, {
        method: "POST",
        body: JSON.stringify({
          model: input.model,
          messages,
          stream: true,
          options: { num_ctx: input.numCtx },
          ...(input.showThinking ? {} : { think: false }),
        }),
        signal: input.signal,
      });
      if (!r.ok || !r.body) {
        const body = (await r.json().catch(() => ({}))) as Json;
        return { ...result(), error: str(body.error) || `Ollama answered ${r.status}` };
      }
      await readLines(r.body, onLine);
    }
  } catch (e) {
    if (input.signal.aborted) return { ...result(), stopped: true };
    const message = isDesktop() ? (e instanceof Error ? e.message : String(e)) : browserError(e, clean(input.url));
    return { ...result(), error: message ?? "Stopped." };
  }
  if (input.signal.aborted) return { ...result(), stopped: true };
  if (parser.state.error) {
    const e = parser.state.error;
    return {
      ...result(),
      error: /not found/i.test(e) ? `The model “${input.model}” isn't installed in Ollama. Download it in Settings → AI → Local models.` : e,
    };
  }
  return result();
}
