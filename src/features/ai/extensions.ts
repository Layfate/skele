// MCP servers, plugins and skills for the AI workspace.
//
// MCP servers configured in Skele are handed to Claude Code / Codex only for the chats that
// turn them on (Skele never edits the CLIs' own config files). Plugins are installed with the
// CLIs' own `plugin` commands. Skills are SKILL.md folders in ~/.claude/skills and
// ~/.codex/skills, which both CLIs read.

import { appMeta } from "@/data/registry";
import { newId, now } from "@/data/common";
import { claudeCatalog, tauri, type ClaudeCatalog, type CliTool, type McpSpec } from "./providers/cli";
import { serial } from "./store";
import type { McpServer } from "./types";

// ── Skele's MCP servers ─────────────────────────────────────────────────────────────────

const MCP_KEY = "ai:mcp";

export const listMcpServers = async (): Promise<McpServer[]> => (await appMeta.get<McpServer[]>(MCP_KEY)) ?? [];

export const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function validateMcpServer(s: Pick<McpServer, "name" | "transport" | "command" | "url">, others: McpServer[] = [], id?: string): string | null {
  if (!MCP_NAME.test(s.name)) return "Use letters, digits, - and _ for the name (it's how its tools are named).";
  if (others.some((o) => o.name === s.name && o.id !== id)) return `There's already a server called ${s.name}.`;
  if (s.transport === "stdio" && !s.command.trim()) return "Enter the command that starts the server.";
  if (s.transport !== "stdio" && !/^https?:\/\/\S+$/.test(s.url.trim())) return "Enter the server's URL (https://…).";
  return null;
}

export function saveMcpServer(server: Omit<McpServer, "id" | "createdAt"> & { id?: string }): Promise<McpServer> {
  return serial(async () => {
    const list = await listMcpServers();
    const error = validateMcpServer(server, list, server.id);
    if (error) throw new Error(error);
    const saved: McpServer = { ...server, id: server.id ?? newId(), createdAt: list.find((s) => s.id === server.id)?.createdAt ?? now() };
    const next = list.some((s) => s.id === saved.id) ? list.map((s) => (s.id === saved.id ? saved : s)) : [...list, saved];
    await appMeta.set(MCP_KEY, next);
    return saved;
  });
}

export const deleteMcpServer = (id: string) =>
  serial(async () => appMeta.set(MCP_KEY, (await listMcpServers()).filter((s) => s.id !== id)));

export const toSpec = (s: McpServer): McpSpec => ({
  name: s.name,
  transport: s.transport,
  command: s.command,
  args: s.args,
  env: s.env,
  url: s.url,
  headers: s.headers,
});

/** The enabled servers a chat has turned on. */
export function chatServers(all: McpServer[], ids: string[] | undefined): McpServer[] {
  const on = new Set(ids ?? []);
  return all.filter((s) => s.enabled && on.has(s.id));
}

export type McpTestResult = { ok: boolean; server?: string; version?: string; tools: string[]; error?: string; authRequired: boolean };

export async function testMcpServer(s: McpServer): Promise<McpTestResult> {
  const { invoke } = await tauri();
  return invoke<McpTestResult>("ai_mcp_test", { server: toSpec(s) });
}

/** A server configured in Claude Code or Codex itself (secrets masked). */
export type CliMcpServer = {
  name: string;
  transport: string;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  envKeys?: string[] | null;
  enabled: boolean;
};

export async function cliMcpServers(tool: CliTool, path?: string): Promise<CliMcpServer[]> {
  const { invoke } = await tauri();
  return invoke<CliMcpServer[]>("ai_cli_mcp_list", { tool, path: path || null });
}

// Presets: well-known servers, ready to add. `{folder}` asks for a folder.
export type McpPreset = {
  id: string;
  name: string;
  title: string;
  description: string;
  transport: McpServer["transport"];
  /** Program and arguments for stdio servers (npx/uvx are wrapped in `cmd /c` on Windows). */
  command?: string;
  args?: string[];
  url?: string;
  /** Values the user fills in: env vars (stdio) or headers (http). */
  fields?: { key: string; label: string; secret?: boolean; header?: string; prefix?: string; placeholder?: string }[];
  needsFolder?: boolean;
  requires?: string;
  docs: string;
};

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "filesystem",
    name: "files",
    title: "Filesystem",
    description: "Read, search and write files in a folder you choose.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "{folder}"],
    needsFolder: true,
    requires: "Node.js",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "fetch",
    name: "fetch",
    title: "Fetch",
    description: "Fetch web pages and turn them into Markdown.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    requires: "uv (Python)",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "memory",
    name: "memory",
    title: "Memory",
    description: "A knowledge graph the AI can store facts in and recall across chats.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    requires: "Node.js",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "sequential-thinking",
    name: "thinking",
    title: "Sequential thinking",
    description: "Structured step-by-step problem solving.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    requires: "Node.js",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
  {
    id: "time",
    name: "time",
    title: "Time",
    description: "Current time and time-zone conversions.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time"],
    requires: "uv (Python)",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
  },
  {
    id: "git",
    name: "git",
    title: "Git",
    description: "Read history, diffs and branches of a Git repository.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git", "--repository", "{folder}"],
    needsFolder: true,
    requires: "uv (Python)",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
  },
  {
    id: "playwright",
    name: "browser",
    title: "Playwright browser",
    description: "Open and use web pages in a real browser.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    requires: "Node.js",
    docs: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "context7",
    name: "context7",
    title: "Context7",
    description: "Up-to-date documentation for programming libraries.",
    transport: "http",
    url: "https://mcp.context7.com/mcp",
    fields: [{ key: "CONTEXT7_API_KEY", label: "API key (optional)", secret: true, header: "CONTEXT7_API_KEY" }],
    docs: "https://github.com/upstash/context7",
  },
  {
    id: "github",
    name: "github",
    title: "GitHub",
    description: "Issues, pull requests and code on GitHub.",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    fields: [{ key: "token", label: "Personal access token", secret: true, header: "Authorization", prefix: "Bearer ", placeholder: "github_pat_…" }],
    docs: "https://github.com/github/github-mcp-server",
  },
];

const WRAP_ON_WINDOWS = new Set(["npx", "uvx", "npm", "pnpm", "bunx", "yarn"]);

/** Turns a preset and the user's values into a server (Windows needs `cmd /c` for npx/uvx). */
export function fromPreset(p: McpPreset, values: Record<string, string>, folder: string | null, os: string | undefined): Omit<McpServer, "id" | "createdAt"> {
  const args = (p.args ?? []).map((a) => (a === "{folder}" ? folder ?? "" : a));
  let command = p.command ?? "";
  let finalArgs = args;
  if (os === "windows" && WRAP_ON_WINDOWS.has(command)) {
    finalArgs = ["/c", command, ...args];
    command = "cmd";
  }
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const f of p.fields ?? []) {
    const v = values[f.key]?.trim();
    if (!v) continue;
    if (f.header) headers[f.header] = `${f.prefix ?? ""}${v}`;
    else env[f.key] = v;
  }
  return {
    name: p.name,
    transport: p.transport,
    command,
    args: finalArgs,
    env,
    url: p.url ?? "",
    headers,
    enabled: true,
    autoAttach: false,
    preset: p.id,
  };
}

type Json = Record<string, unknown>;
const strMap = (v: unknown): Record<string, string> =>
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Json).filter(([, x]) => typeof x === "string") as [string, string][]) : {};

/**
 * Servers from pasted JSON: `{"mcpServers": {...}}` (Claude Desktop, Cursor, Claude Code),
 * `{"servers": {...}}` (VS Code), a `{ name: server }` map, or one server with a "name".
 */
export function parseMcpJson(text: string): Omit<McpServer, "id" | "createdAt">[] {
  const data = JSON.parse(text) as Json;
  const map = (data.mcpServers ?? data.servers ?? data.mcp_servers) as Json | undefined;
  const entries: [string, Json][] = map
    ? Object.entries(map as Record<string, Json>)
    : typeof data.name === "string"
      ? [[data.name, data]]
      : Object.entries(data as Record<string, Json>).filter(([, v]) => v && typeof v === "object" && ("command" in v || "url" in v));
  if (!entries.length) throw new Error("No MCP servers found in that JSON.");
  return entries.map(([name, s]) => {
    const url = typeof s.url === "string" ? s.url : typeof s.serverUrl === "string" ? s.serverUrl : "";
    const type = String(s.type ?? s.transport ?? (url ? "http" : "stdio")).toLowerCase();
    const transport: McpServer["transport"] = type === "sse" ? "sse" : url ? "http" : "stdio";
    return {
      name: name.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64),
      transport,
      command: typeof s.command === "string" ? s.command : "",
      args: Array.isArray(s.args) ? s.args.map(String) : [],
      env: strMap(s.env),
      url,
      headers: strMap(s.headers ?? s.http_headers),
      enabled: true,
      autoAttach: false,
    };
  });
}

// ── Plugins ─────────────────────────────────────────────────────────────────────────────

export type Captured = { ok: boolean; code: number | null; stdout: string; stderr: string; timedOut: boolean };

export type ManageAction =
  | { action: "pluginList" }
  | { action: "pluginInstall"; id: string; acceptCommand?: string }
  | { action: "pluginUninstall"; id: string }
  | { action: "pluginEnable"; id: string }
  | { action: "pluginDisable"; id: string }
  | { action: "pluginUpdate"; id: string }
  | { action: "marketplaceList" }
  | { action: "marketplaceAdd"; source: string }
  | { action: "marketplaceRemove"; name: string }
  | { action: "marketplaceUpdate" };

export async function cliManage(tool: CliTool, action: ManageAction, path?: string): Promise<Captured> {
  const { invoke } = await tauri();
  return invoke<Captured>("ai_cli_manage", { tool, path: path || null, action });
}

/** The JSON in a CLI's output (some versions print a notice first). */
export function jsonFrom<T>(stdout: string): T | null {
  const t = stdout.trim();
  for (const start of [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0).sort((a, b) => a - b)) {
    try {
      return JSON.parse(t.slice(start)) as T;
    } catch {
      // try the next candidate
    }
  }
  // One JSON object per line: take the last one.
  for (const line of t.split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line) as T;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Readable error for a failed management command. */
export function captureError(c: Captured, what: string) {
  if (c.timedOut) return `${what} took too long and was stopped.`;
  const json = jsonFrom<Json>(c.stdout);
  const msg = (json && (json.error ?? json.message)) || c.stderr.trim().split(/\r?\n/).slice(-3).join("\n") || c.stdout.trim().slice(-400);
  return `${what} failed${msg ? `: ${String(typeof msg === "object" ? JSON.stringify(msg) : msg)}` : "."}`;
}

export type Plugin = {
  pluginId: string;
  name: string;
  description?: string;
  marketplaceName?: string;
  version?: string;
  enabled?: boolean;
  installed?: boolean;
};

export type PluginList = { installed: Plugin[]; available: Plugin[] };

/**
 * One plugin from either CLI. Claude Code lists installed plugins by `id`
 * ("name@marketplace") with no name; available ones (and Codex's) have `pluginId` + `name`.
 */
export function normalizePlugin(raw: Plugin & { id?: string }): Plugin | null {
  const pluginId = raw.pluginId || raw.id;
  if (!pluginId) return null;
  const [base, market] = pluginId.split("@");
  return { ...raw, pluginId, name: raw.name || base, marketplaceName: raw.marketplaceName || market || undefined };
}

export function pluginListFrom(stdout: string): PluginList | null {
  const data = jsonFrom<Partial<PluginList> | Plugin[]>(stdout);
  if (!data) return null;
  const norm = (list: unknown) => (Array.isArray(list) ? list : []).map(normalizePlugin).filter((p): p is Plugin => !!p);
  if (Array.isArray(data)) return { installed: norm(data).map((p) => ({ ...p, installed: true, enabled: p.enabled ?? true })), available: [] };
  const available = norm(data.available);
  const byId = new Map(available.map((p) => [p.pluginId, p]));
  const installed = norm(data.installed).map((p) => ({
    ...p,
    // Claude Code leaves descriptions off installed plugins; the marketplace entry has it.
    description: p.description || byId.get(p.pluginId)?.description,
    installed: true,
    enabled: p.enabled ?? true,
  }));
  const ids = new Set(installed.map((p) => p.pluginId));
  return { installed, available: available.filter((p) => !ids.has(p.pluginId)) };
}

export async function listPlugins(tool: CliTool, path?: string): Promise<PluginList> {
  const out = await cliManage(tool, { action: "pluginList" }, path);
  if (!out.ok) throw new Error(captureError(out, "Listing plugins"));
  const list = pluginListFrom(out.stdout);
  if (!list) throw new Error("Couldn't read the plugin list.");
  return list;
}

export type Marketplace = { name: string; source?: string; repo?: string; url?: string; path?: string; installLocation?: string };

export async function listMarketplaces(tool: CliTool, path?: string): Promise<Marketplace[]> {
  const out = await cliManage(tool, { action: "marketplaceList" }, path);
  if (!out.ok) throw new Error(captureError(out, "Listing marketplaces"));
  const data = jsonFrom<Marketplace[] | { marketplaces?: Marketplace[] }>(out.stdout);
  if (!data) return [];
  return Array.isArray(data) ? data : (data.marketplaces ?? []);
}

/**
 * Claude Code asks before running a command a marketplace declares for an install. The
 * --json result then names it (`shownCommand`), so Skele can show it and ask the user.
 */
export function pendingCommand(c: Captured): { command: string; sha256: string } | null {
  const json = jsonFrom<Json>(c.stdout);
  const shown = json?.shownCommand as Json | undefined;
  if (!shown || typeof shown.sha256 !== "string") return null;
  const command = typeof shown.command === "string" ? shown.command : JSON.stringify(shown.command ?? shown);
  return { command, sha256: shown.sha256 };
}

// ── Skills ──────────────────────────────────────────────────────────────────────────────

export type Skill = { tool: CliTool; name: string; title?: string | null; description?: string | null; path: string; linked: boolean };

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function listSkills(): Promise<Skill[]> {
  const { invoke } = await tauri();
  return invoke<Skill[]>("ai_skills_list");
}

export async function readSkill(tool: CliTool, name: string) {
  const { invoke } = await tauri();
  return invoke<string>("ai_skill_read", { tool, name });
}

export async function writeSkill(tool: CliTool, name: string, content: string) {
  const { invoke } = await tauri();
  return invoke<string>("ai_skill_write", { tool, name, content });
}

export async function deleteSkill(tool: CliTool, name: string) {
  const { invoke } = await tauri();
  await invoke("ai_skill_delete", { tool, name });
}

export async function importSkill(tool: CliTool) {
  const { invoke } = await tauri();
  return invoke<string | null>("ai_skill_import", { tool });
}

const yaml = (s: string) => (/[:#\-{}[\],&*!|>'"%@`]|^\s|\s$/.test(s) ? JSON.stringify(s) : s);

/** A new SKILL.md from a name, a description and instructions. */
export function skillMarkdown(name: string, description: string, body: string) {
  return `---\nname: ${name}\ndescription: ${yaml(description.replace(/\s+/g, " ").trim())}\n---\n\n${body.trim()}\n`;
}

// ── What "/" offers in a chat: skills, plugin skills and plugin commands ─────────────────

/** One entry in the "/" menu that goes to the CLI. */
export type SkillEntry = {
  /** What follows the "/" ("pdf", "anthropic-skills:pdf"). */
  name: string;
  description?: string | null;
  /** The plugin it comes from ("anthropic-skills"), if any. */
  plugin?: string;
  kind: "skill" | "command";
};

const CATALOG_KEY = "ai:claude-catalog";

export type SavedCatalog = ClaudeCatalog & { at: string };

/** Claude Code's catalog from the last time Skele asked (instant on startup). */
export const savedClaudeCatalog = () => appMeta.get<SavedCatalog>(CATALOG_KEY);

/** Asks Claude Code again (free: its local /context command) and keeps the answer. */
export async function refreshClaudeCatalog(path?: string): Promise<SavedCatalog | null> {
  const c = await claudeCatalog(path);
  if (c.error && !c.skills.length) return (await savedClaudeCatalog()) ?? null;
  const saved = { ...c, at: now() };
  await appMeta.set(CATALOG_KEY, saved);
  return saved;
}

/** Short descriptions for skills that ship inside Claude Code (they have no file on disk). */
const BUILTIN_SKILLS: Record<string, string> = {
  simplify: "Review changed code for reuse, simplification and efficiency, then fix it",
  "code-review": "Review the current diff for bugs",
  "security-review": "Security review of the pending changes",
  batch: "Run a task across many files or items in parallel",
  loop: "Run a prompt or command on a recurring interval",
  schedule: "Create and manage scheduled cloud agents",
  debug: "Track down the cause of a bug",
  verify: "Check that a change actually works",
  "claude-api": "Build with the Claude API and Anthropic SDKs",
  run: "Launch and drive this project's app",
  "update-config": "Configure Claude Code's settings.json",
  "fewer-permission-prompts": "Allowlist common read-only commands",
  dataviz: "Make charts and data visualizations",
  "plugin-authoring": "Write a Claude Code mod or plugin",
  "skill-creator": "Create and improve skills",
  init: "Write a CLAUDE.md for this project",
};

const bare = (name: string) => name.slice(name.indexOf(":") + 1);
const pluginOf = (name: string) => (name.includes(":") ? name.slice(0, name.indexOf(":")) : undefined);

/**
 * The "/" menu entries for a CLI. Claude Code: everything it reported (its own skills, plugin
 * skills and plugin commands), with descriptions from disk; plus skill folders it hasn't
 * reported yet. Codex: its skill folders.
 */
export function skillEntries(tool: CliTool, local: Skill[], catalog: ClaudeCatalog | null | undefined): SkillEntry[] {
  const out = new Map<string, SkillEntry>();
  const localDesc = new Map(local.filter((s) => s.tool === tool).map((s) => [s.name, s.description]));
  if (tool === "claude" && catalog) {
    const describe = (name: string) => catalog.descriptions[bare(name)] ?? localDesc.get(bare(name)) ?? BUILTIN_SKILLS[bare(name)] ?? null;
    for (const name of catalog.skills) out.set(name, { name, description: describe(name), plugin: pluginOf(name), kind: "skill" });
    for (const name of catalog.commands) {
      if (!name.includes(":") || out.has(name)) continue;
      out.set(name, { name, description: describe(name), plugin: pluginOf(name), kind: "command" });
    }
  }
  for (const s of local) {
    if (s.tool !== tool || out.has(s.name)) continue;
    out.set(s.name, { name: s.name, description: s.description, kind: "skill" });
  }
  return [...out.values()].sort((a, b) => Number(!!a.plugin) - Number(!!b.plugin) || a.name.localeCompare(b.name));
}

/** Plugins Claude Code loaded, with the skills/commands each adds (built-in ones left out). */
export function catalogPlugins(catalog: ClaudeCatalog): { name: string; source?: string; entries: string[] }[] {
  const byPlugin = new Map<string, Set<string>>();
  for (const name of [...catalog.skills, ...catalog.commands]) {
    const p = pluginOf(name);
    if (p) byPlugin.set(p, (byPlugin.get(p) ?? new Set()).add(name));
  }
  const list = catalog.plugins
    .filter((p) => p.path !== "builtin" && !p.source?.endsWith("@builtin"))
    .map((p) => ({ name: p.name, source: p.source, entries: [...(byPlugin.get(p.name) ?? [])] }));
  for (const [name, entries] of byPlugin) {
    if (!list.some((p) => p.name === name)) list.push({ name, source: undefined, entries: [...entries] });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
