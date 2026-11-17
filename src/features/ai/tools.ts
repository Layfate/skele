// Tools for the API models (Claude API, OpenAI API, OpenRouter). Claude Code and Codex bring
// their own; API models get these instead, from the same per-chat settings (the shield button):
//
// - Read files / Edit files: list, read and search in the chat's folder, plus write and edit
//   in Edit mode. Run by the desktop app (src-tauri/src/ai_tools.rs), confined to the folder.
// - MCP servers the chat turned on: their tools, through sessions the desktop app keeps open.
// - Web search: each provider's own (Claude's web_search tool, OpenAI's web_search,
//   OpenRouter's web plugin), so nothing runs here for it.
//
// Each provider runs its own loop (its message format differs) and calls `runTool` here.

import { isDesktop } from "@/lib/desktop";
import { toSpec } from "./extensions";
import type { Chat, McpServer } from "./types";
import { workspaceTools } from "./workspace";

export type ApiTool = {
  /** Unique, [a-zA-Z0-9_-]{1,64} (the strictest provider's rule). */
  name: string;
  description: string;
  /** JSON Schema for the arguments (an object). */
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
  /** One line for the reply's activity list. */
  label: (args: Record<string, unknown>) => string;
};

export type ApiTooling = { tools: ApiTool[]; web: boolean };

export const noTooling: ApiTooling = { tools: [], web: false };

/** Most rounds of tool calls in one reply, so a confused model can't loop forever. */
export const MAX_TOOL_ROUNDS = 30;

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Tauri commands reject with strings; make them readable for the model. */
const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));

function fileTools(folder: string, write: boolean): ApiTool[] {
  const call = (tool: string) => async (args: Record<string, unknown>) => {
    try {
      return { text: await invoke<string>("ai_file_tool", { folder, write, tool, args }) };
    } catch (e) {
      return { text: errText(e), isError: true };
    }
  };
  const path = (a: Record<string, unknown>) => String(a.path ?? ".");
  const tools: ApiTool[] = [
    {
      name: "list_files",
      description: `List files and folders (3 levels deep) in the user's folder ${folder}, or a subfolder of it. Paths are relative to that folder.`,
      parameters: obj({ path: str("Subfolder to list, relative to the folder. Omit for the whole folder.") }, []),
      run: call("list_files"),
      label: (a) => `Listed ${path(a)}`,
    },
    {
      name: "read_file",
      description: "Read a text file in the user's folder. Returns numbered lines (up to 2000 at a time; use offset for more).",
      parameters: obj({ path: str("File path, relative to the folder."), offset: int("First line to read (1-based)."), limit: int("How many lines to read.") }, ["path"]),
      run: call("read_file"),
      label: (a) => `Read ${path(a)}`,
    },
    {
      name: "search_files",
      description: "Search file names and contents in the user's folder for a phrase (case-insensitive). Returns path:line: text matches.",
      parameters: obj({ query: str("The text to look for."), path: str("Subfolder to search in, relative to the folder. Omit for all of it.") }, ["query"]),
      run: call("search_files"),
      label: (a) => `Searched for “${String(a.query ?? "")}”`,
    },
  ];
  if (write) {
    tools.push(
      {
        name: "write_file",
        description: "Create a file, or replace a file's whole content, in the user's folder. Prefer edit_file for changes to existing files.",
        parameters: obj({ path: str("File path, relative to the folder."), content: str("The complete new content.") }, ["path", "content"]),
        run: call("write_file"),
        label: (a) => `Wrote ${path(a)}`,
      },
      {
        name: "edit_file",
        description: "Replace one exact, unique piece of text in a file in the user's folder. Read the file first and copy old_text exactly, with enough context to be unique.",
        parameters: obj({ path: str("File path, relative to the folder."), old_text: str("The exact text to replace."), new_text: str("The text to put in its place.") }, ["path", "old_text", "new_text"]),
        run: call("edit_file"),
        label: (a) => `Edited ${path(a)}`,
      },
    );
  }
  return tools;
}

type McpToolInfo = { name: string; description: string; inputSchema: Record<string, unknown> };

/** A tool name the providers accept: [a-zA-Z0-9_-], at most 64 characters, unique. */
export function toolName(server: string, tool: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  let name = `${clean(server)}__${clean(tool)}`.slice(0, 64);
  for (let i = 2; taken.has(name); i++) name = `${name.slice(0, 60)}_${i}`;
  taken.add(name);
  return name;
}

async function mcpTools(servers: McpServer[], note: (line: string) => void): Promise<ApiTool[]> {
  const taken = new Set<string>();
  const lists = await Promise.all(
    servers.map(async (s) => {
      try {
        return { s, tools: await invoke<McpToolInfo[]>("ai_mcp_tools", { server: toSpec(s) }) };
      } catch (e) {
        note(`MCP server ${s.name} couldn't start: ${errText(e).split("\n")[0]}`);
        return { s, tools: [] };
      }
    }),
  );
  return lists.flatMap(({ s, tools }) =>
    tools.map((t) => ({
      name: toolName(s.name, t.name, taken),
      description: `${t.description || t.name} (MCP server ${s.name})`.slice(0, 1000),
      parameters: t.inputSchema?.type === "object" ? t.inputSchema : { type: "object", properties: {} },
      run: async (args: Record<string, unknown>) => {
        try {
          return await invoke<{ text: string; isError: boolean }>("ai_mcp_call", { server: toSpec(s), tool: t.name, args });
        } catch (e) {
          return { text: errText(e), isError: true };
        }
      },
      label: () => `${s.name}: ${t.name}`,
    })),
  );
}

/**
 * The tools a chat's API model gets this turn: searching and reading the workspace (when the
 * AI may see it), plus files, MCP servers and web search from the chat's access settings.
 */
export async function apiTooling(
  chat: Pick<Chat, "mode" | "folder" | "web" | "workspaceId">,
  mcp: McpServer[],
  note: (line: string) => void,
  workspace = false,
): Promise<ApiTooling> {
  const tools: ApiTool[] = workspace ? workspaceTools(chat.workspaceId) : [];
  if (isDesktop()) {
    const mode = chat.mode ?? "chat";
    if ((mode === "read" || mode === "edit") && chat.folder) tools.push(...fileTools(chat.folder, mode === "edit"));
    if (mcp.length) tools.push(...(await mcpTools(mcp, note)));
  }
  return { tools, web: !!chat.web };
}

/**
 * Checks a model's arguments against the tool's schema: an object with every required
 * field, of the right basic type. Streamed tool inputs can arrive cut off, so this runs
 * before every call. Null when fine, else what's wrong.
 */
export function checkArgs(schema: Record<string, unknown>, args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "The arguments must be a JSON object.";
  const a = args as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Record<string, { type?: string | string[] }>;
  for (const key of (schema.required as string[] | undefined) ?? []) {
    if (a[key] === undefined || a[key] === null) return `Missing "${key}".`;
  }
  for (const [key, value] of Object.entries(a)) {
    const t = props[key]?.type;
    if (!t || value === null) continue;
    const types = Array.isArray(t) ? t : [t];
    const actual = Array.isArray(value) ? "array" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
    const ok = types.some((x) => x === actual || (x === "number" && actual === "integer"));
    if (!ok) return `"${key}" should be ${types.join(" or ")}, not ${actual}.`;
  }
  return null;
}

/** Parses a provider's JSON arguments string (empty means none). */
export function parseArgs(raw: string | undefined | null): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Runs one tool call: checks its arguments, runs it, and reports it as activity. */
export async function runTool(tooling: ApiTooling, name: string, args: unknown, activity: (line: string) => void): Promise<{ text: string; isError: boolean }> {
  const tool = tooling.tools.find((t) => t.name === name);
  if (!tool) return { text: `There's no tool called ${name}.`, isError: true };
  const problem = checkArgs(tool.parameters, args);
  if (problem) return { text: `Invalid arguments for ${name}: ${problem} Send the call again with complete JSON.`, isError: true };
  const a = args as Record<string, unknown>;
  activity(tool.label(a));
  const r = await tool.run(a);
  if (r.isError) activity(`  ↳ ${r.text.split("\n")[0].slice(0, 160)}`);
  return { text: r.text || "(no output)", isError: !!r.isError };
}

/** Sums token usage over the rounds of a tool loop. */
export function addUsage<T extends { inputTokens: number; outputTokens: number; cachedTokens?: number; costUsd?: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    ...a,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0) || undefined,
    costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) || undefined,
  };
}

/** Text from several rounds of a tool loop, one paragraph each. */
export const joinRounds = (before: string, now: string) => (before && now ? `${before}\n\n${now}` : before || now);
