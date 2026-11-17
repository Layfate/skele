import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeParser, codexParser } from "@/features/ai/providers/cli";
import type { TurnHandlers } from "@/features/ai/providers/types";
import { DEFAULT_AI_SETTINGS, type Chat, type ChatMessage } from "@/features/ai/types";

const runCli = vi.fn();
vi.mock("@/features/ai/providers/cli", async (orig) => ({
  ...(await orig<typeof import("@/features/ai/providers/cli")>()),
  runCli: (...args: unknown[]) => runCli(...args),
}));
// Replies here don't read a workspace (that would open the storage engine before the
// storage tests below choose the browser one).
vi.mock("@/features/ai/workspace", () => ({ workspaceIndex: async () => "", workspaceTools: () => [], referencedPages: async () => [] }));
// CLI providers need the desktop app; storage tests use the browser (IndexedDB) engine.
const env = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/lib/desktop", () => ({ isDesktop: () => env.desktop }));

const handlers = (): TurnHandlers & { texts: string[] } => {
  const texts: string[] = [];
  return { texts, text: (t) => texts.push(t), thinking: () => {}, activity: () => {}, session: () => {} };
};

describe("Claude Code stream parser", () => {
  it("streams text deltas, records the session and ignores sub-agent output", () => {
    const on = handlers();
    const p = claudeParser(on);
    p.line({ type: "system", subtype: "init", session_id: "s-1" });
    p.line({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "hel" } } });
    p.line({ type: "stream_event", parent_tool_use_id: "t1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "XX" } } });
    p.line({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } });
    p.line({ type: "result", subtype: "success", is_error: false, result: "hello", session_id: "s-1" });
    expect(p.state).toMatchObject({ text: "hello", sessionId: "s-1", error: "" });
    expect(on.texts).toEqual(["hel", "hello"]);
  });

  it("uses the final result when no deltas arrived, and reports errors", () => {
    const ok = claudeParser(handlers());
    ok.line({ type: "result", is_error: false, result: "whole answer" });
    expect(ok.state.text).toBe("whole answer");
    const bad = claudeParser(handlers());
    bad.line({ type: "result", is_error: true, result: "Not logged in · Please run /login" });
    expect(bad.state.error).toMatch(/Not logged in/);
  });
});

describe("Codex stream parser", () => {
  it("joins agent messages, keeps reasoning and steps, and reads the thread id", () => {
    const p = codexParser(handlers());
    p.line({ type: "thread.started", thread_id: "th-9" });
    p.line({ type: "item.completed", item: { id: "r0", type: "reasoning", text: "Thinking about it" } });
    p.line({ type: "item.started", item: { id: "c1", type: "command_execution", command: "ls" } });
    p.line({ type: "item.completed", item: { id: "c1", type: "command_execution", command: "ls" } });
    p.line({ type: "item.completed", item: { id: "m1", type: "agent_message", text: "First." } });
    p.line({ type: "item.completed", item: { id: "m2", type: "agent_message", text: "Second." } });
    expect(p.state).toMatchObject({ sessionId: "th-9", text: "First.\n\nSecond.", thinking: "Thinking about it" });
    expect(p.state.activity).toEqual(["Ran `ls`"]);
  });

  it("reports a failed turn", () => {
    const p = codexParser(handlers());
    p.line({ type: "turn.failed", error: { message: "usage limit reached" } });
    expect(p.state.error).toBe("usage limit reached");
  });
});

describe("CLI turns", () => {
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

  beforeEach(() => {
    runCli.mockReset();
    runCli.mockResolvedValue({ text: "ok" });
  });

  async function prompt(c: Chat) {
    const { runTurn } = await import("@/features/ai/run");
    await runTurn({ chat: c, settings: DEFAULT_AI_SETTINGS, signal: new AbortController().signal, on: handlers() });
    return runCli.mock.calls[0][0] as { prompt: string; sessionId?: string; tool: string; systemPrompt?: string };
  }

  it("resumes an up-to-date session with just the new message", async () => {
    const c = chat([msg("user", "hi"), msg("assistant", "hello"), msg("user", "next")], { sessions: { "claude-cli": { id: "s1", upTo: 2 } } });
    const call = await prompt(c);
    expect(call).toMatchObject({ tool: "claude", sessionId: "s1", prompt: "next" });
    expect(call.systemPrompt).toMatch(/Skele/);
  });

  it("never sends Skele's own /command answers to a model", async () => {
    const c = chat([
      msg("user", "/usage", { local: true }),
      msg("assistant", "**Claude Code** 26% used", { local: true }),
      msg("user", "hello"),
    ]);
    const call = await prompt(c);
    expect(call.prompt).toBe("hello");
  });

  it("catches a tool up on replies another provider gave", async () => {
    const c = chat([msg("user", "hi"), msg("assistant", "from codex", { provider: "codex-cli" }), msg("user", "and you?")]);
    const call = await prompt(c);
    expect(call.sessionId).toBeUndefined();
    expect(call.prompt).toContain("Assistant (Codex): from codex");
    expect(call.prompt.endsWith("and you?")).toBe(true);
  });

  it("sends attached page text and gives Codex the instructions in its first message", async () => {
    const c = chat([msg("user", "summarize", { context: '<page title="Plan">Ship it</page>' })], { provider: "codex-cli", model: "" });
    const call = await prompt(c);
    expect(call.tool).toBe("codex");
    expect(call.prompt).toMatch(/^<instructions>/);
    expect(call.prompt).toContain('<page title="Plan">Ship it</page>\n\nsummarize');
  });
});

describe("chat storage", () => {
  beforeAll(() => {
    env.desktop = false;
  });

  it("creates, updates, lists and deletes chats per workspace", async () => {
    const store = await import("@/features/ai/store");
    const a = await store.createChat({ workspaceId: "ws-a", provider: "anthropic", model: "claude-opus-5-5" });
    await store.createChat({ workspaceId: "ws-b", provider: "openai", model: "x" });
    await store.updateChat(a.id, (c) => ({ ...c, title: "Renamed", messages: [{ id: "1", role: "user", content: "Hello there", createdAt: "" }] }));
    const list = await store.listChats("ws-a");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, title: "Renamed", preview: "Hello there" });
    await store.deleteChat("ws-a", a.id);
    expect(await store.listChats("ws-a")).toEqual([]);
    await expect(store.getChat(a.id)).rejects.toThrow(/not found/i);
  });

  it("keeps settings with defaults", async () => {
    const store = await import("@/features/ai/store");
    await store.updateAiSettings({ anthropicKey: "k" });
    expect(await store.getAiSettings()).toMatchObject({ anthropicKey: "k", showThinking: true, defaultProvider: null });
  });
});

describe("slash commands", () => {
  it("recognises Skele's commands only", async () => {
    const { parseCommand } = await import("@/features/ai/commands");
    expect(parseCommand("/usage")).toEqual({ name: "usage", args: "" });
    expect(parseCommand("  /Status ")).toEqual({ name: "status", args: "" });
    expect(parseCommand("/model sonnet")).toEqual({ name: "model", args: "sonnet" });
    expect(parseCommand("/compact")).toEqual({ name: "compact", args: "" });
    // Anything else starting with "/" is a skill, sent to the CLI.
    expect(parseCommand("/pdf-tools fill this")).toBeNull();
    expect(parseCommand("what is /usage")).toBeNull();
  });

  it("reads Claude Code and Codex limit readings", async () => {
    const { claudeWindows, codexWindows } = await import("@/features/ai/limits");
    const claude = claudeWindows({
      rateLimitType: "seven_day",
      utilization: 0.57,
      unifiedWindows: {
        five_hour: { utilization: 0.26, resetsAt: 1794646200, status: "allowed" },
        seven_day: { utilization: 0.57, resetsAt: 1795089600, status: "allowed_warning" },
      },
    });
    expect(claude).toEqual([
      { label: "Current session (5 hours)", usedPercent: 26, resetsAt: 1794646200 },
      { label: "Weekly · all models", usedPercent: 57, resetsAt: 1795089600 },
    ]);
    expect(claudeWindows({ rateLimitType: "five_hour", utilization: 0.5 })).toEqual([
      { label: "Current session (5 hours)", usedPercent: 50, resetsAt: undefined },
    ]);
    const codex = codexWindows({
      primary: { used_percent: 17, window_minutes: 300, resets_at: 1794646904 },
      secondary: { used_percent: 34, window_minutes: 10080, resets_at: 1795174772 },
      plan_type: "plus",
    });
    expect(codex.map((w) => [w.label, w.usedPercent])).toEqual([
      ["Current session (5 hours)", 17],
      ["Weekly", 34],
    ]);
  });
});
