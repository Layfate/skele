// Claude Code and Codex through the user's own command-line tools (desktop app only). The
// Rust side (src-tauri/src/ai.rs) runs the tool and streams its JSON lines; this file turns
// them into text, reasoning, activity, usage and refused tool uses.

import { newId } from "@/data/common";
import { effortFor, type AccessMode, type Effort, type ModelOption, type TurnUsage } from "../types";
import type { TurnHandlers, TurnImage, TurnResult } from "./types";

export type CliTool = "claude" | "codex";

export type CliStatus = { tool: CliTool | "ollama"; path: string | null; version: string | null; error: string | null };

type RunResult = { exitCode: number | null; stderr: string; cancelled: boolean };

/** An MCP server as the Rust side expects it. */
export type McpSpec = {
  name: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
};

export async function tauri() {
  return import("@tauri-apps/api/core");
}

export async function cliStatus(paths: { claude?: string; codex?: string; ollama?: string }): Promise<CliStatus[]> {
  const { invoke } = await tauri();
  const clean = Object.fromEntries(Object.entries(paths).filter(([, v]) => !!v?.trim()));
  return invoke<CliStatus[]>("ai_cli_status", { paths: clean });
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** File name only, for activity lines ("Read notes.md"). */
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** One readable line for a Claude Code tool use. */
export function describeClaudeTool(name: string, input: Json): string {
  switch (name) {
    case "Read":
      return `Read \`${base(str(input.file_path))}\``;
    case "Glob":
      return `Looked for files matching \`${str(input.pattern)}\``;
    case "Grep":
      return `Searched files for \`${str(input.pattern)}\``;
    case "Edit":
    case "MultiEdit":
      return `Edited \`${base(str(input.file_path))}\``;
    case "Write":
      return `Wrote \`${base(str(input.file_path))}\``;
    case "NotebookEdit":
      return `Edited notebook \`${base(str(input.notebook_path))}\``;
    case "WebSearch":
      return `Searched the web for “${str(input.query)}”`;
    case "WebFetch":
      return `Read ${str(input.url)}`;
    case "Agent":
    case "Task":
      return `Asked the **${str(input.subagent_type) || "general"}** agent: ${str(input.description)}`;
    case "Skill":
      return `Used the \`${str(input.skill) || str(input.name)}\` skill`;
    case "Bash":
      return `Ran \`${str(input.command).slice(0, 120)}\``;
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `Used **${mcp[1]}** → \`${mcp[2]}\``;
  return `Used \`${name}\``;
}

/** Parses Claude Code `--output-format stream-json` lines. */
export function claudeParser(on: TurnHandlers) {
  const state = {
    text: "",
    thinking: "",
    sessionId: "",
    /** The model Claude Code is running (from its init event). */
    model: "",
    error: "",
    done: false,
    rateLimit: undefined as Json | undefined,
    activity: [] as string[],
    denied: [] as string[],
    usage: undefined as TurnUsage | undefined,
  };
  const seen = new Set<string>();
  // Text from earlier steps (before a tool use) is kept, separated from the next step.
  let prior = "";
  let stepText = "";
  const pushText = (delta: string) => {
    stepText += delta;
    on.text((state.text = joinSteps(prior, stepText)));
  };
  return {
    state,
    line(event: Json) {
      if (event.session_id && !state.sessionId) {
        state.sessionId = str(event.session_id);
        on.session(state.sessionId);
      }
      if (event.type === "system" && event.subtype === "init") {
        state.model = str(event.model);
        // MCP servers that couldn't start are worth knowing about.
        for (const s of (event.mcp_servers as Json[] | undefined) ?? []) {
          if (s.status === "failed") {
            const line = `Couldn't start the **${str(s.name)}** MCP server`;
            state.activity.push(line);
            on.activity(line);
          }
        }
      } else if (event.type === "stream_event" && !event.parent_tool_use_id) {
        const e = event.event as Json;
        if (e?.type === "message_start" && stepText) {
          prior = joinSteps(prior, stepText);
          stepText = "";
        }
        const delta = e?.type === "content_block_delta" ? (e.delta as Json) : null;
        if (delta?.type === "text_delta") pushText(str(delta.text));
        else if (delta?.type === "thinking_delta") {
          state.thinking += str(delta.thinking);
          on.thinking(state.thinking);
        }
      } else if (event.type === "assistant" && !event.parent_tool_use_id) {
        const content = ((event.message as Json)?.content as Json[] | undefined) ?? [];
        for (const block of content) {
          if (block.type !== "tool_use") continue;
          const id = str(block.id) || `${str(block.name)}:${JSON.stringify(block.input)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const line = describeClaudeTool(str(block.name), (block.input as Json) ?? {});
          state.activity.push(line);
          on.activity(line);
        }
      } else if (event.type === "rate_limit_event" && event.rate_limit_info) {
        state.rateLimit = event.rate_limit_info as Json;
      } else if (event.type === "result") {
        state.done = true;
        const u = event.usage as Json | undefined;
        if (u) {
          state.usage = {
            inputTokens: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens),
            outputTokens: num(u.output_tokens),
            cachedTokens: num(u.cache_read_input_tokens) || undefined,
            costUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined,
          };
        }
        for (const d of (event.permission_denials as Json[] | undefined) ?? []) {
          state.denied.push(describeClaudeTool(str(d.tool_name), (d.tool_input as Json) ?? {}));
        }
        if (event.is_error) state.error = str(event.result) || str(event.subtype) || "Claude Code reported an error.";
        else if (!state.text && typeof event.result === "string") {
          state.text = event.result;
          on.text(state.text);
        }
      }
    },
  };
}

function joinSteps(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return `${a.trimEnd()}\n\n${b.trimStart()}`;
}

/** Parses `codex exec --json` lines. Codex sends whole items rather than token deltas. */
export function codexParser(on: TurnHandlers) {
  const state = {
    text: "",
    thinking: "",
    sessionId: "",
    error: "",
    activity: [] as string[],
    denied: [] as string[],
    usage: undefined as TurnUsage | undefined,
  };
  const messages = new Map<string, string>();
  const reasoning = new Map<string, string>();
  const seen = new Set<string>();
  const join = (m: Map<string, string>) => [...m.values()].filter(Boolean).join("\n\n");
  const step = (id: string, line: string) => {
    if (!line || seen.has(id)) return;
    seen.add(id);
    state.activity.push(line);
    on.activity(line);
  };
  return {
    state,
    line(event: Json) {
      if (event.type === "thread.started") {
        state.sessionId = str(event.thread_id);
        on.session(state.sessionId);
      } else if (event.type === "turn.completed") {
        const u = event.usage as Json | undefined;
        if (u) {
          state.usage = {
            inputTokens: num(u.input_tokens),
            outputTokens: num(u.output_tokens),
            cachedTokens: num(u.cached_input_tokens) || undefined,
          };
        }
      } else if (event.type === "turn.failed") {
        state.error = str((event.error as Json)?.message) || "Codex couldn't finish this turn.";
      } else if (event.type === "error") {
        state.error = str(event.message) || "Codex reported an error.";
      } else if (typeof event.type === "string" && event.type.startsWith("item.")) {
        const item = (event.item ?? {}) as Json;
        const id = str(item.id);
        switch (item.type) {
          case "agent_message":
            messages.set(id, str(item.text));
            state.text = join(messages);
            on.text(state.text);
            break;
          case "reasoning":
            reasoning.set(id, str(item.text));
            state.thinking = join(reasoning);
            on.thinking(state.thinking);
            break;
          case "command_execution":
            step(id, `Ran \`${str(item.command)}\``);
            break;
          case "web_search":
            step(id, `Searched the web for “${str(item.query)}”`);
            break;
          case "file_change": {
            const changes = (item.changes as Json[] | undefined) ?? [];
            const files = changes.map((c) => `\`${base(str(c.path))}\``).join(", ");
            step(id, files ? `Changed ${files}` : "Changed files");
            break;
          }
          case "mcp_tool_call":
            step(id, `Used **${str(item.server)}** → \`${str(item.tool)}\``);
            break;
          case "error":
            step(id, `Note: ${str(item.message)}`);
            break;
        }
      }
    },
  };
}

/** Raw output of `claude auth status --json` / `codex login status`. */
export async function cliAuth(tool: CliTool, path?: string): Promise<{ ok: boolean; output: string }> {
  const { invoke } = await tauri();
  return invoke("ai_cli_auth", { tool, path: path || null });
}

/** Codex's newest plan-limit reading from its session logs, if any. */
export async function codexUsage(): Promise<{ rateLimits: Json; timestamp?: string } | null> {
  const { invoke } = await tauri();
  return invoke("ai_codex_usage");
}

/** Models Codex offers this account (from its own model cache). */
export async function codexModels(): Promise<ModelOption[]> {
  const { invoke } = await tauri();
  return invoke<ModelOption[]>("ai_codex_models");
}

/** Native folder picker; returns the folder or null. `full`: any folder (where a full-access chat starts). */
export async function pickFolder(full = false): Promise<string | null> {
  const { invoke } = await tauri();
  return invoke<string | null>("ai_pick_folder", { full });
}

/** Checks a typed folder path; returns the full path, or throws why it can't be used. */
export async function checkFolder(path: string, full = false): Promise<string> {
  const { invoke } = await tauri();
  return invoke<string>("ai_check_folder", { path, full });
}

/** Readable tail of a tool's error output. */
function stderrMessage(stderr: string) {
  const lines = stderr
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-4).join("\n");
}

export type CliRunInput = {
  tool: CliTool;
  prompt: string;
  model: string;
  effort: Effort;
  sessionId?: string;
  systemPrompt?: string;
  path?: string;
  /** Keep no session on disk (quick checks). */
  ephemeral?: boolean;
  mode?: AccessMode;
  folder?: string;
  /** "full" only: also run shell commands. */
  shell?: boolean;
  web?: boolean;
  mcpServers?: McpSpec[];
  useCliExtensions?: boolean;
  allowSkills?: boolean;
  /** Claude Code sub-agents. */
  agents?: Record<string, { description: string; prompt: string; model?: string }>;
  /** Images sent with this message. */
  images?: TurnImage[];
  signal: AbortSignal;
  on: TurnHandlers;
};

export async function runCli(input: CliRunInput): Promise<TurnResult> {
  const { Channel, invoke } = await tauri();
  const runId = newId();
  const parser = input.tool === "claude" ? claudeParser(input.on) : codexParser(input.on);
  const channel = new Channel<string>();
  channel.onmessage = (line) => {
    try {
      parser.line(JSON.parse(line) as Json);
    } catch {
      // Not JSON (a warning line): ignore.
    }
  };
  const cancel = () => void invoke("ai_cli_cancel", { runId }).catch(() => {});
  if (input.signal.aborted) return { text: "", stopped: true };
  input.signal.addEventListener("abort", cancel, { once: true });

  const base = (): TurnResult => ({
    text: parser.state.text,
    thinking: parser.state.thinking,
    activity: parser.state.activity.length ? parser.state.activity : undefined,
    denied: parser.state.denied.length ? parser.state.denied : undefined,
    sessionId: parser.state.sessionId || undefined,
    usage: parser.state.usage,
    rateLimit: (parser.state as { rateLimit?: Json }).rateLimit,
    modelId: (parser.state as { model?: string }).model || undefined,
  });
  try {
    const result = await invoke<RunResult>("ai_cli_run", {
      args: {
        runId,
        tool: input.tool,
        prompt: input.prompt,
        model: input.model || null,
        effort: effortFor(input.tool === "claude" ? "claude-cli" : "codex-cli", input.effort),
        sessionId: input.sessionId || null,
        systemPrompt: input.systemPrompt || null,
        path: input.path || null,
        ephemeral: !!input.ephemeral,
        mode: input.mode ?? "chat",
        folder: input.folder || null,
        shell: input.mode === "full" && !!input.shell,
        web: !!input.web,
        mcpServers: input.mcpServers ?? [],
        useCliExtensions: !!input.useCliExtensions,
        allowSkills: !!input.allowSkills,
        agents: input.agents && Object.keys(input.agents).length ? input.agents : null,
        images: input.images ?? [],
      },
      onEvent: channel,
    });
    if (result.cancelled || input.signal.aborted) return { ...base(), stopped: true };
    if (parser.state.error) return { ...base(), error: parser.state.error };
    if (result.exitCode !== 0 && !parser.state.text) {
      const name = input.tool === "claude" ? "Claude Code" : "Codex";
      return { ...base(), error: stderrMessage(result.stderr) || `${name} exited with code ${result.exitCode ?? "unknown"}.` };
    }
    return base();
  } catch (error) {
    return { ...base(), error: error instanceof Error ? error.message : String(error) };
  } finally {
    input.signal.removeEventListener("abort", cancel);
  }
}

/** What Claude Code offers, as it reported when it last started (see `ai_claude_catalog`). */
export type ClaudeCatalog = {
  /** The model chats use when none is chosen, e.g. "claude-opus-5-5". */
  model: string | null;
  version: string | null;
  /** Skills it can run; plugin skills are namespaced ("plugin:skill"). */
  skills: string[];
  /** Every slash command, including plugin commands. */
  commands: string[];
  plugins: { name: string; path?: string; source?: string }[];
  /** Description per skill / command name (the part after "plugin:"). */
  descriptions: Record<string, string>;
  error: string | null;
};

/** Asks Claude Code what it offers. Runs its local /context command: no usage is spent. */
export async function claudeCatalog(path?: string): Promise<ClaudeCatalog> {
  const { invoke } = await tauri();
  return invoke<ClaudeCatalog>("ai_claude_catalog", { path: path || null });
}
