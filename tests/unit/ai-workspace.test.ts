// The AI workspace: context fitting, limits and fallback decisions, agents and mentions,
// MCP config import, the CLI/Ollama stream parsers, multi-agent session catch-up, and the
// reply pipeline's local fallback.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claudeParser, codexParser } from "@/features/ai/providers/cli";
import { ollamaParser } from "@/features/ai/providers/ollama";
import type { TurnHandlers } from "@/features/ai/providers/types";
import { DEFAULT_AI_SETTINGS, type Agent, type Chat, type ChatMessage } from "@/features/ai/types";

const runCli = vi.fn();
vi.mock("@/features/ai/providers/cli", async (orig) => ({
  ...(await orig<typeof import("@/features/ai/providers/cli")>()),
  runCli: (...args: unknown[]) => runCli(...args),
}));
const streamOllama = vi.fn();
vi.mock("@/features/ai/providers/ollama", async (orig) => ({
  ...(await orig<typeof import("@/features/ai/providers/ollama")>()),
  streamOllama: (...args: unknown[]) => streamOllama(...args),
}));
const env = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/lib/desktop", () => ({ isDesktop: () => env.desktop, desktopInfo: async () => null }));

const handlers = (): TurnHandlers & { texts: string[]; steps: string[] } => {
  const texts: string[] = [];
  const steps: string[] = [];
  return { texts, steps, text: (t) => texts.push(t), thinking: () => {}, activity: (l) => steps.push(l), session: () => {} };
};

const msg = (role: "user" | "assistant", content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: Math.random().toString(36).slice(2),
  role,
  content,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const chat = (messages: ChatMessage[], extra: Partial<Chat> = {}): Chat => ({
  id: "c",
  workspaceId: "w",
  title: "t",
  provider: "claude-cli",
  model: "sonnet",
  effort: "medium",
  createdAt: "",
  updatedAt: "",
  messages,
  ...extra,
});

const agent = (name: string, extra: Partial<Agent> = {}): Agent => ({
  id: `id-${name}`,
  name,
  description: `${name} desc`,
  instructions: `You are ${name}.`,
  provider: null,
  model: "",
  subagent: false,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("context optimization", () => {
  it("sends page text attached twice only with its newest copy", async () => {
    const { dedupePages } = await import("@/features/ai/context");
    const page = '<page title="Plan">\nShip it\n</page>';
    const changed = '<page title="Plan">\nShip it today\n</page>';
    const out = dedupePages([`${page}\n\nfirst`, `${page}\n\nagain`, `${changed}\n\nedited`]);
    expect(out[0]).toContain("attached again further down");
    expect(out[1]).toContain("Ship it\n</page>");
    expect(out[2]).toContain("Ship it today");
  });

  it("fits a long history into the budget, keeping the newest messages and starting with the user", async () => {
    const { buildHistory } = await import("@/features/ai/context");
    const long = "x".repeat(4000); // ~1000 tokens each
    const messages = Array.from({ length: 10 }, (_, i) => msg(i % 2 ? "assistant" : "user", `${i}:${long}`));
    messages.push(msg("user", "latest question"));
    const h = buildHistory(chat(messages), 3000, { provider: "anthropic" });
    expect(h.omitted).toBeGreaterThan(0);
    expect(h.tokens).toBeLessThanOrEqual(3100);
    expect(h.messages[0].role).toBe("user");
    expect(h.messages[0].content).toMatch(/left out to fit/);
    expect(h.messages.at(-1)!.content).toBe("latest question");
  });

  it("replaces summarised messages with the summary and skips Skele's own answers", async () => {
    const { buildHistory, chatTokens } = await import("@/features/ai/context");
    const c = chat(
      [msg("user", "old"), msg("assistant", "old reply"), msg("user", "/usage", { local: true }), msg("assistant", "card", { local: true }), msg("user", "new")],
      { summary: { text: "We discussed X.", upTo: 2, at: "" } },
    );
    const h = buildHistory(c, 10_000, { provider: "ollama" });
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0].content).toMatch(/<conversation_summary>[\s\S]*We discussed X\.[\s\S]*new$/);
    expect(chatTokens(c)).toBeLessThan(40);
  });

  it("labels other agents' replies so a model knows who said what", async () => {
    const { buildHistory } = await import("@/features/ai/context");
    const c = chat([msg("user", "hi"), msg("assistant", "from b", { agentId: "b", agentName: "bee" }), msg("user", "next")]);
    const h = buildHistory(c, 10_000, { provider: "anthropic", agentId: "a" });
    expect(h.messages[1].content).toBe("[Reply from @bee]\nfrom b");
    const own = buildHistory(c, 10_000, { provider: "anthropic", agentId: "b" });
    expect(own.messages[1].content).toBe("from b");
  });

  it("budgets small local context windows", async () => {
    const { contextBudget } = await import("@/features/ai/context");
    expect(contextBudget("ollama", { ollamaContext: 8192 })).toBe(5844);
    expect(contextBudget("anthropic", { ollamaContext: 8192 })).toBe(150_000);
  });
});

describe("limits and fallback decisions", () => {
  it("classifies provider errors", async () => {
    const { classifyError, canFallBack } = await import("@/features/ai/limits");
    expect(classifyError("Claude AI usage limit reached|1794664200")).toBe("limit");
    expect(classifyError("You've hit your usage limit. Upgrade or try again at 3pm")).toBe("limit");
    expect(classifyError("Rate limited by the Claude API. Wait a moment and try again.")).toBe("limit");
    expect(classifyError("Not logged in · Please run /login")).toBe("auth");
    expect(classifyError("Couldn't find the `codex` command. Install it…")).toBe("missing");
    expect(classifyError("Couldn't reach the Claude API. Check your internet connection.")).toBe("network");
    expect(classifyError("Claude declined to answer this.")).toBe("other");
    expect(canFallBack("other")).toBe(false);
    expect(canFallBack("limit")).toBe(true);
  });

  it("reads the fullest live window and ignores windows that already reset", async () => {
    const { limitState } = await import("@/features/ai/limits");
    const now = 1_800_000_000_000;
    const future = now / 1000 + 3600;
    const past = now / 1000 - 60;
    expect(
      limitState(
        [
          { label: "5h", usedPercent: 100, resetsAt: past },
          { label: "week", usedPercent: 72, resetsAt: future },
        ],
        false,
        now,
      ),
    ).toEqual({ blocked: false, usedPercent: 72, label: "week", resetsAt: future });
    expect(limitState([{ label: "5h", usedPercent: 100, resetsAt: future }], false, now)?.blocked).toBe(true);
    expect(limitState([{ label: "5h", usedPercent: 40, resetsAt: past }], false, now)).toBeNull();
  });

  it("keeps a per-day usage ledger and totals it", async () => {
    const { addToLedger, ledgerTotals } = await import("@/features/ai/limits");
    let l = { days: {} };
    l = addToLedger(l, "claude-cli", { inputTokens: 100, outputTokens: 20, costUsd: 0.01 }, "2026-11-14");
    l = addToLedger(l, "claude-cli", { inputTokens: 50, outputTokens: 5, cachedTokens: 40 }, "2026-11-14");
    l = addToLedger(l, "ollama", { inputTokens: 10, outputTokens: 10 }, "2026-11-01");
    const today = ledgerTotals(l, 1, new Date(2026, 10, 14));
    expect(today["claude-cli"]).toEqual({ turns: 2, input: 150, output: 25, cached: 40, cost: 0.01 });
    expect(today.ollama).toBeUndefined();
    expect(ledgerTotals(l, 30, new Date(2026, 10, 14)).ollama?.turns).toBe(1);
  });
});

describe("agents", () => {
  it("finds @mentions in order, once each, ignoring e-mail addresses", async () => {
    const { mentionedAgents } = await import("@/features/ai/agents");
    const list = [agent("reviewer"), agent("editor")];
    expect(mentionedAgents("@Editor and @reviewer, then @editor again", list).map((a) => a.name)).toEqual(["editor", "reviewer"]);
    expect(mentionedAgents("mail me at me@reviewer.com", list)).toEqual([]);
    expect(mentionedAgents("@nobody", list)).toEqual([]);
  });

  it("validates names and builds Claude Code sub-agents", async () => {
    const { validateAgent, claudeSubagents } = await import("@/features/ai/agents");
    expect(validateAgent({ name: "bad name", instructions: "x" }, [])).toMatch(/letters/);
    expect(validateAgent({ name: "Editor", instructions: "x" }, [agent("editor")])).toMatch(/already/);
    expect(validateAgent({ name: "ok", instructions: " " }, [])).toMatch(/Describe/);
    const subs = claudeSubagents([
      agent("reviewer", { subagent: true, provider: "claude-cli", model: "haiku" }),
      agent("quiet"),
      agent("local", { subagent: true, provider: "ollama", model: "llama3" }),
    ]);
    expect(Object.keys(subs)).toEqual(["reviewer", "local"]);
    expect(subs.reviewer).toEqual({ description: "reviewer desc", prompt: "You are reviewer.", model: "haiku" });
    expect(subs.local.model).toBeUndefined();
  });
});

describe("MCP servers", () => {
  it("imports Claude Desktop, VS Code and single-server JSON", async () => {
    const { parseMcpJson } = await import("@/features/ai/extensions");
    const desktop = parseMcpJson(
      JSON.stringify({ mcpServers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: { A: "1", N: 2 } } } }),
    );
    expect(desktop).toEqual([
      expect.objectContaining({ name: "memory", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: { A: "1" } }),
    ]);
    const vscode = parseMcpJson(JSON.stringify({ servers: { "my docs": { type: "http", url: "https://x.dev/mcp", headers: { Authorization: "Bearer t" } } } }));
    expect(vscode[0]).toMatchObject({ name: "my-docs", transport: "http", url: "https://x.dev/mcp", headers: { Authorization: "Bearer t" } });
    expect(parseMcpJson(JSON.stringify({ name: "s", type: "sse", url: "https://y/sse" }))[0].transport).toBe("sse");
    expect(() => parseMcpJson("{}")).toThrow(/No MCP servers/);
  });

  it("builds servers from presets, wrapping npx in cmd on Windows", async () => {
    const { fromPreset, MCP_PRESETS, validateMcpServer } = await import("@/features/ai/extensions");
    const fs = MCP_PRESETS.find((p) => p.id === "filesystem")!;
    const win = fromPreset(fs, {}, "C:\\proj", "windows");
    expect(win.command).toBe("cmd");
    expect(win.args).toEqual(["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "C:\\proj"]);
    expect(fromPreset(fs, {}, "/proj", "macos").command).toBe("npx");
    const gh = fromPreset(MCP_PRESETS.find((p) => p.id === "github")!, { token: "abc" }, null, "linux");
    expect(gh.headers).toEqual({ Authorization: "Bearer abc" });
    expect(validateMcpServer({ ...gh, name: "has space" })).toMatch(/letters/);
    expect(validateMcpServer({ ...gh, url: "ftp://x" })).toMatch(/URL/);
  });

  it("only hands a chat the servers it turned on and that are enabled", async () => {
    const { chatServers } = await import("@/features/ai/extensions");
    const base = { transport: "stdio" as const, command: "x", args: [], env: {}, url: "", headers: {}, autoAttach: false, createdAt: "" };
    const all = [
      { ...base, id: "1", name: "a", enabled: true },
      { ...base, id: "2", name: "b", enabled: false },
      { ...base, id: "3", name: "c", enabled: true },
    ];
    expect(chatServers(all, ["1", "2"]).map((s) => s.name)).toEqual(["a"]);
    expect(chatServers(all, undefined)).toEqual([]);
  });

  it("reads CLI JSON output, including a notice before it, and pending install commands", async () => {
    const { jsonFrom, pendingCommand } = await import("@/features/ai/extensions");
    expect(jsonFrom<{ installed: unknown[] }>('Note: updating marketplaces\n{"installed":[],"available":[]}')?.installed).toEqual([]);
    expect(jsonFrom("not json")).toBeNull();
    const out = { ok: false, code: 1, timedOut: false, stderr: "", stdout: JSON.stringify({ shownCommand: { command: "npm i x", sha256: "ab".repeat(32) } }) };
    expect(pendingCommand(out)).toEqual({ command: "npm i x", sha256: "ab".repeat(32) });
  });

  it("writes SKILL.md front matter safely", async () => {
    const { skillMarkdown } = await import("@/features/ai/extensions");
    expect(skillMarkdown("notes", "Use when: notes are shared", "# Steps")).toBe('---\nname: notes\ndescription: "Use when: notes are shared"\n---\n\n# Steps\n');
  });
});

describe("stream parsers", () => {
  it("Claude Code: tool steps, refused tools, usage and failed MCP servers", () => {
    const on = handlers();
    const p = claudeParser(on);
    p.line({ type: "system", subtype: "init", session_id: "s", mcp_servers: [{ name: "files", status: "failed" }, { name: "ok", status: "connected" }] });
    p.line({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start" } });
    p.line({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Let me look." } } });
    p.line({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "C:\\p\\notes.md" } }] } });
    p.line({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "C:\\p\\notes.md" } }] } });
    p.line({ type: "assistant", parent_tool_use_id: "x", message: { content: [{ type: "tool_use", id: "t9", name: "Grep", input: {} }] } });
    p.line({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start" } });
    p.line({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Found it." } } });
    p.line({
      type: "result",
      is_error: false,
      result: "Found it.",
      usage: { input_tokens: 4, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 30 },
      total_cost_usd: 0.002,
      permission_denials: [{ tool_name: "Bash", tool_input: { command: "rm -rf x" } }, { tool_name: "mcp__github__create_issue", tool_input: {} }],
    });
    expect(p.state.text).toBe("Let me look.\n\nFound it.");
    expect(p.state.activity).toEqual(["Couldn't start the **files** MCP server", "Read `notes.md`"]);
    expect(p.state.denied).toEqual(["Ran `rm -rf x`", "Used **github** → `create_issue`"]);
    expect(p.state.usage).toEqual({ inputTokens: 1004, outputTokens: 30, cachedTokens: 900, costUsd: 0.002 });
  });

  it("Codex: usage and changed files", () => {
    const p = codexParser(handlers());
    p.line({ type: "item.completed", item: { id: "f", type: "file_change", changes: [{ path: "/p/a.ts" }, { path: "/p/b.md" }] } });
    p.line({ type: "turn.completed", usage: { input_tokens: 1500, cached_input_tokens: 1200, output_tokens: 40 } });
    expect(p.state.activity).toEqual(["Changed `a.ts`, `b.md`"]);
    expect(p.state.usage).toEqual({ inputTokens: 1500, outputTokens: 40, cachedTokens: 1200 });
  });

  it("Ollama: streamed content, thinking, token counts and errors", () => {
    const on = handlers();
    const p = ollamaParser(on);
    p.line({ message: { role: "assistant", thinking: "hmm" } });
    p.line({ message: { role: "assistant", content: "Hel" } });
    p.line({ message: { role: "assistant", content: "lo" } });
    p.line({ done: true, prompt_eval_count: 12, eval_count: 3 });
    expect(p.state).toMatchObject({ text: "Hello", thinking: "hmm", done: true, usage: { inputTokens: 12, outputTokens: 3 } });
    expect(on.texts).toEqual(["Hel", "Hello"]);
    const bad = ollamaParser(handlers());
    bad.line({ error: 'model "x" not found, try pulling it first' });
    expect(bad.state.error).toMatch(/not found/);
  });
});

describe("turns", () => {
  beforeEach(() => {
    env.desktop = true;
    runCli.mockReset();
    runCli.mockResolvedValue({ text: "ok" });
    streamOllama.mockReset();
    streamOllama.mockResolvedValue({ text: "local ok" });
  });

  async function cliCall(c: Chat, extra: Record<string, unknown> = {}) {
    const { runTurn } = await import("@/features/ai/run");
    await runTurn({ chat: c, settings: DEFAULT_AI_SETTINGS, signal: new AbortController().signal, on: handlers(), ...extra });
    return runCli.mock.calls[0][0] as Record<string, unknown> & { prompt: string };
  }

  it("passes the chat's access, folder, web and MCP servers to the CLI", async () => {
    const server = { id: "1", name: "files", transport: "stdio" as const, command: "npx", args: ["x"], env: { K: "v" }, url: "", headers: {}, enabled: true, autoAttach: false, createdAt: "" };
    const call = await cliCall(chat([msg("user", "list files")], { mode: "read", folder: "/proj", web: true }), { mcp: [server] });
    expect(call).toMatchObject({ mode: "read", folder: "/proj", web: true, allowSkills: false });
    expect(call.mcpServers).toEqual([{ name: "files", transport: "stdio", command: "npx", args: ["x"], env: { K: "v" }, url: "", headers: {} }]);
    expect(String(call.systemPrompt)).toMatch(/read files in the folder \/proj/);
  });

  it("keeps a /skill first so the CLI recognises it, with context after", async () => {
    const c = chat([msg("user", "hi"), msg("assistant", "hello", { provider: "codex-cli" }), msg("user", "/pdf-tools fill the form", { context: '<page title="F">\nform\n</page>' })]);
    const call = await cliCall(c);
    expect(call.allowSkills).toBe(true);
    expect(call.prompt.startsWith("/pdf-tools fill the form\n\n<page")).toBe(true);
    expect(call.prompt).toContain("Assistant (Codex): hello");
  });

  it("turns a /skill into Codex's $skill mention", async () => {
    const call = await cliCall(chat([msg("user", "/notes tidy this")], { provider: "codex-cli", model: "" }));
    expect(call.prompt).toMatch(/<\/instructions>\n\n\$notes tidy this$/);
  });

  it("gives each agent its own session and catches it up on the other agents' replies", async () => {
    const a = agent("a");
    const replyA = msg("assistant", "A says", { agentId: a.id, agentName: "a" });
    const replyB = msg("assistant", "B says", { agentId: "id-b", agentName: "b" });
    const c = chat([msg("user", "q1"), replyA, replyB, msg("user", "q2")], {
      sessions: { [`claude-cli:${a.id}`]: { id: "sess-a", upTo: 1, replyId: replyA.id } },
    });
    const call = await cliCall(c, { agent: a, agents: [a], multi: true });
    expect(call.sessionId).toBe("sess-a");
    expect(call.prompt).toContain("Assistant (@b): B says");
    expect(call.prompt).not.toContain("A says");
    expect(call.prompt.endsWith("q2")).toBe(true);
    expect(String(call.systemPrompt)).toMatch(/you are "@a"\. You are a\./);
  });

  it("uses an agent's own provider and model", async () => {
    const { runTurn } = await import("@/features/ai/run");
    const r = await runTurn({
      chat: chat([msg("user", "hi")]),
      settings: { ...DEFAULT_AI_SETTINGS, ollamaModel: "llama3.2" },
      signal: new AbortController().signal,
      on: handlers(),
      agent: agent("local", { provider: "ollama", model: "" }),
    });
    expect(r).toMatchObject({ provider: "ollama", model: "llama3.2", text: "local ok" });
    expect(runCli).not.toHaveBeenCalled();
    expect(streamOllama.mock.calls[0][0]).toMatchObject({ model: "llama3.2", numCtx: 8192 });
  });

  it("only offers Ollama once a model is chosen", async () => {
    const { providerAvailable, defaultProvider } = await import("@/features/ai/run");
    env.desktop = false;
    expect(providerAvailable("ollama", DEFAULT_AI_SETTINGS)).toBe(false);
    const s = { ...DEFAULT_AI_SETTINGS, ollamaModel: "qwen3" };
    expect(providerAvailable("ollama", s)).toBe(true);
    expect(defaultProvider(s)).toBe("ollama");
  });

  it("recognises skills but not Skele's own commands", async () => {
    const { skillInvocation } = await import("@/features/ai/run");
    expect(skillInvocation("/pdf-tools go")).toBe("pdf-tools");
    expect(skillInvocation("/plugin:skill")).toBe("plugin:skill");
    expect(skillInvocation("/usage")).toBeNull();
    expect(skillInvocation("not /a skill")).toBeNull();
  });
});

describe("commands", () => {
  beforeEach(() => {
    env.desktop = true;
  });

  it("/model switches the chat's model and /mode needs a folder", async () => {
    const { runCommand } = await import("@/features/ai/commands");
    const ctx = { mcp: [], agents: [] };
    const m = await runCommand("model", "haiku", chat([]), DEFAULT_AI_SETTINGS, ctx);
    expect(m.patch).toEqual({ model: "haiku" });
    expect((await runCommand("model", "a b", chat([]), DEFAULT_AI_SETTINGS, ctx)).patch).toBeUndefined();
    expect((await runCommand("mode", "edit", chat([]), DEFAULT_AI_SETTINGS, ctx)).patch).toBeUndefined();
    expect((await runCommand("mode", "edit", chat([], { folder: "/p" }), DEFAULT_AI_SETTINGS, ctx)).patch).toEqual({ mode: "edit" });
    const api = await runCommand("mode", "read", chat([], { provider: "anthropic" }), DEFAULT_AI_SETTINGS, ctx);
    expect(api.content).toMatch(/can only chat/);
    expect((await runCommand("compact", "", chat([]), DEFAULT_AI_SETTINGS, ctx)).compact).toBe(true);
  });

  it("/agents lists agents with how to mention them", async () => {
    const { runCommand } = await import("@/features/ai/commands");
    const out = await runCommand("agents", "", chat([]), DEFAULT_AI_SETTINGS, { mcp: [], agents: [agent("reviewer", { subagent: true })] });
    expect(out.content).toMatch(/@reviewer.*sub-agent/);
  });
});

describe("local fallback", () => {
  const settings = { ...DEFAULT_AI_SETTINGS, ollamaModel: "llama3.2", localFallback: true };
  const input = (s = settings) => ({ chat: chat([msg("user", "hi")]), settings: s, signal: new AbortController().signal, on: handlers() });

  beforeEach(() => {
    env.desktop = false; // no plan-limit reading to consult
    runCli.mockReset();
    streamOllama.mockReset();
    streamOllama.mockResolvedValue({ text: "local answer" });
  });

  it("answers locally when the CLI is at its usage limit", async () => {
    const { runWithFallback } = await import("@/features/ai/fallback");
    runCli.mockResolvedValue({ text: "", error: "Claude AI usage limit reached|1794664200" });
    const switched = vi.fn();
    const { result, fallback } = await runWithFallback(input(), switched);
    expect(result).toMatchObject({ provider: "ollama", model: "llama3.2", text: "local answer" });
    expect(fallback).toEqual({ from: "claude-cli", reason: "Claude Code is at its usage limit." });
    expect(switched).toHaveBeenCalledWith({ provider: "ollama", model: "llama3.2" }, "Claude Code is at its usage limit.");
  });

  it("keeps the original error for other failures, partial replies, stops, or when turned off", async () => {
    const { runWithFallback } = await import("@/features/ai/fallback");
    runCli.mockResolvedValueOnce({ text: "", error: "Claude declined to answer this." });
    expect((await runWithFallback(input(), () => {})).fallback).toBeUndefined();
    runCli.mockResolvedValueOnce({ text: "half an answer", error: "Not logged in" });
    expect((await runWithFallback(input(), () => {})).result.text).toBe("half an answer");
    runCli.mockResolvedValueOnce({ text: "", error: "usage limit reached", stopped: true });
    expect((await runWithFallback(input(), () => {})).fallback).toBeUndefined();
    runCli.mockResolvedValueOnce({ text: "", error: "usage limit reached" });
    const off = await runWithFallback(input({ ...settings, localFallback: false }), () => {});
    expect(off.result).toMatchObject({ provider: "claude-cli", error: "usage limit reached" });
    expect(streamOllama).not.toHaveBeenCalled();
  });

  it("turns a thrown error into a reply error instead of failing the whole turn", async () => {
    const { runWithFallback } = await import("@/features/ai/fallback");
    runCli.mockRejectedValue(new Error("Couldn't find the `claude` command."));
    const { result, fallback } = await runWithFallback(input(), () => {});
    expect(fallback?.reason).toBe("Claude Code isn't installed.");
    expect(result.text).toBe("local answer");
  });
});
