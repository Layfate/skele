// Skele 0.2.1: model names with versions, the five effort levels, images in chats, and the
// "/" menu's skills, plugin skills and plugin commands from Claude Code's catalog.
import { describe, expect, it, vi } from "vitest";
import { buildHistory, chatTokens, IMAGE_TOKENS, transcript } from "@/features/ai/context";
import { catalogPlugins, skillEntries, type Skill } from "@/features/ai/extensions";
import { claudeParser, type ClaudeCatalog } from "@/features/ai/providers/cli";
import { noHandlers } from "@/features/ai/providers/types";
import { skillInvocation, systemPrompt } from "@/features/ai/run";
import { parseCommand, runCommand } from "@/features/ai/commands";
import { DEFAULT_AI_SETTINGS, effortFor, maxEffort, prettyModel, type Chat, type ChatImage, type ChatMessage } from "@/features/ai/types";

vi.mock("@/lib/desktop", () => ({ isDesktop: () => false, desktopInfo: async () => null }));

const img: ChatImage = { id: "i1", mediaType: "image/png", data: "iVBORw0KGgo=", width: 10, height: 10 };
const msg = (role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: Math.random().toString(36).slice(2),
  role,
  content,
  createdAt: "2026-11-15T00:00:00Z",
  ...extra,
});
const chat = (messages: ChatMessage[], extra: Partial<Chat> = {}): Chat => ({
  id: "c1",
  workspaceId: "w",
  title: "t",
  provider: "claude-cli",
  model: "",
  effort: "medium",
  createdAt: "",
  updatedAt: "",
  messages,
  ...extra,
});

describe("model names", () => {
  it("shows the version of a model id or alias", () => {
    expect(prettyModel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(prettyModel("claude-fable-5-2")).toBe("Fable 5.2");
    expect(prettyModel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(prettyModel("claude-fable-5")).toBe("Fable 5");
    expect(prettyModel("claude-opus-5-5[1m]")).toBe("Opus 5.5 (1M)");
    expect(prettyModel("sonnet")).toBe("Sonnet 5.5");
    expect(prettyModel("gpt-5-codex")).toBe("gpt-5-codex");
    expect(prettyModel("")).toBe("");
  });

  it("reads the exact model from Claude Code's init event", () => {
    const p = claudeParser(noHandlers);
    p.line({ type: "system", subtype: "init", session_id: "s", model: "claude-opus-5-5" });
    expect(p.state.model).toBe("claude-opus-5-5");
  });
});

describe("effort", () => {
  it("lowers the effort to what a provider accepts", () => {
    expect(effortFor("claude-cli", "max")).toBe("max");
    expect(effortFor("anthropic", "xhigh")).toBe("xhigh");
    expect(effortFor("codex-cli", "max")).toBe("xhigh");
    expect(effortFor("openai", "xhigh")).toBe("high");
    expect(effortFor("codex-cli", "low")).toBe("low");
    expect(maxEffort("ollama")).toBeNull();
  });

  it("/effort switches the chat's effort and explains a lowered one", async () => {
    expect(parseCommand("/effort max")).toEqual({ name: "effort", args: "max" });
    const ctx = { mcp: [], agents: [] };
    const r = await runCommand("effort", "max", chat([], { provider: "codex-cli" }), DEFAULT_AI_SETTINGS, ctx);
    expect(r.patch).toEqual({ effort: "max" });
    expect(r.content).toContain("xhigh");
    const bad = await runCommand("effort", "turbo", chat([]), DEFAULT_AI_SETTINGS, ctx);
    expect(bad.patch).toBeUndefined();
    const none = await runCommand("effort", "", chat([], { provider: "ollama" }), DEFAULT_AI_SETTINGS, ctx);
    expect(none.content).toMatch(/no effort setting/);
  });

  it("tells the model what it runs as", () => {
    const s = systemPrompt(DEFAULT_AI_SETTINGS, undefined, { provider: "claude-cli", model: "fable", effort: "max" });
    expect(s).toContain("Claude Code with the model Fable 5.2, at max effort");
    const codex = systemPrompt(DEFAULT_AI_SETTINGS, undefined, { provider: "codex-cli", model: "", effort: "max" });
    expect(codex).toContain("Codex, at xhigh effort");
  });
});

describe("images in chats", () => {
  it("sends a user message's images and counts them", () => {
    const c = chat([msg("user", "What is this?", { images: [img] }), msg("assistant", "A cat.")]);
    const h = buildHistory(c, 100_000, { provider: "anthropic" });
    expect(h.messages[0].images).toEqual([{ mediaType: "image/png", data: img.data }]);
    expect(h.messages[1].images).toBeUndefined();
    expect(chatTokens(c)).toBeGreaterThanOrEqual(IMAGE_TOKENS);
  });

  it("keeps image-only messages and notes images in transcripts", () => {
    const m = msg("user", "", { images: [img, { ...img, id: "i2" }] });
    expect(transcript([m], () => "User")).toBe("User:  [2 images attached]");
  });
});

describe("skills and plugins in the / menu", () => {
  const catalog: ClaudeCatalog = {
    model: "claude-opus-5-5",
    version: "2.1.325",
    skills: ["simplify", "brand", "anthropic-skills:voxel-pet-design-prompts"],
    commands: ["simplify", "context", "remotion:render", "anthropic-skills:voxel-pet-design-prompts"],
    plugins: [
      { name: "cc-plugin-telemetry", path: "builtin", source: "cc-plugin-telemetry@builtin" },
      { name: "remotion", path: "/x", source: "remotion@remotion" },
    ],
    descriptions: { "voxel-pet-design-prompts": "Designs blocky voxel game creatures", render: "Render a video" },
    error: null,
  };
  const local: Skill[] = [
    { tool: "claude", name: "brand", description: "Brand voice", path: "/b", linked: false },
    { tool: "claude", name: "not-reported", description: "On disk only", path: "/n", linked: false },
    { tool: "codex", name: "codex-only", description: "Codex skill", path: "/c", linked: false },
  ];

  it("lists Claude Code's skills, plugin skills and plugin commands with descriptions", () => {
    const entries = skillEntries("claude", local, catalog);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName["anthropic-skills:voxel-pet-design-prompts"]).toMatchObject({
      plugin: "anthropic-skills",
      kind: "skill",
      description: "Designs blocky voxel game creatures",
    });
    expect(byName["remotion:render"]).toMatchObject({ plugin: "remotion", kind: "command", description: "Render a video" });
    expect(byName.brand.description).toBe("Brand voice");
    expect(byName.simplify.description).toMatch(/simplification/);
    expect(byName["not-reported"]).toBeDefined();
    // Built-in commands like /context aren't skills; Codex skills stay with Codex.
    expect(byName.context).toBeUndefined();
    expect(byName["codex-only"]).toBeUndefined();
    // Own skills first, then plugin ones.
    expect(entries.findIndex((e) => e.plugin)).toBeGreaterThan(entries.findIndex((e) => e.name === "simplify"));
    expect(skillEntries("codex", local, catalog).map((e) => e.name)).toEqual(["codex-only"]);
  });

  it("groups plugins without the built-in ones", () => {
    const plugins = catalogPlugins(catalog);
    expect(plugins.map((p) => p.name)).toEqual(["anthropic-skills", "remotion"]);
    expect(plugins.find((p) => p.name === "remotion")?.entries).toEqual(["remotion:render"]);
  });

  it("sends /plugin:skill to the CLI as a skill", () => {
    expect(skillInvocation("/anthropic-skills:voxel-pet-design-prompts make a frog")).toBe("anthropic-skills:voxel-pet-design-prompts");
    expect(skillInvocation("/effort high")).toBeNull();
    expect(skillInvocation("/plugins")).toBeNull();
  });
});
