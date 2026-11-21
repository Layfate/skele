// Tools for API models: argument checks, tool names, and OpenRouter's tool loop against a
// stubbed fetch (a model that calls a tool, gets the result, then answers).
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiTooling, checkArgs, MAX_API_TOOLS, runTool, toolName, type ApiTooling } from "@/features/ai/tools";
import { streamOpenRouter } from "@/features/ai/providers/openrouter";
import type { TurnHandlers } from "@/features/ai/providers/types";

const schema = { type: "object", properties: { path: { type: "string" }, offset: { type: "integer" } }, required: ["path"] };

const sse = (...events: unknown[]) => events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}`)).join("\n\n") + "\n\n";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/lib/desktop", () => ({ isDesktop: () => true }));
vi.mock("@/features/gmail/ai-tools", () => ({ gmailToolsEnabled: async () => false, gmailTools: () => [] }));

afterEach(() => {
  vi.unstubAllGlobals();
  native.invoke.mockReset();
});

describe("API model tools", () => {
  it("checks arguments before running a tool", () => {
    expect(checkArgs(schema, { path: "a.ts" })).toBeNull();
    expect(checkArgs(schema, { path: "a.ts", offset: 3 })).toBeNull();
    expect(checkArgs(schema, {})).toMatch(/Missing "path"/);
    expect(checkArgs(schema, { path: 3 })).toMatch(/should be string/);
    expect(checkArgs(schema, { path: "a", offset: 1.5 })).toMatch(/should be integer/);
    expect(checkArgs(schema, undefined)).toMatch(/JSON object/);
  });

  it("makes tool names every provider accepts, and unique", () => {
    const taken = new Set<string>();
    expect(toolName("my server", "do.thing", taken)).toBe("my_server__do_thing");
    expect(toolName("my server", "do thing", taken)).toBe("my_server__do_thing_2");
    expect(toolName("s", "x".repeat(100), taken)).toHaveLength(64);
  });

  it("runs a tool only with valid arguments and reports it", async () => {
    const run = vi.fn(async () => ({ text: "file text" }));
    const tooling: ApiTooling = { web: false, tools: [{ name: "read_file", description: "", parameters: schema, run, label: (a) => `Read ${a.path}` }] };
    const lines: string[] = [];
    expect(await runTool(tooling, "read_file", { path: "a.ts" }, (l) => lines.push(l))).toEqual({ text: "file text", isError: false });
    expect(lines).toEqual(["Read a.ts"]);
    expect((await runTool(tooling, "read_file", {}, () => {})).isError).toBe(true);
    expect((await runTool(tooling, "nope", {}, () => {})).isError).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("OpenRouter: calls the tool the model asks for, sends the result back, and answers", async () => {
    const bodies: Record<string, unknown>[] = [];
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "acme/tooly", name: "Tooly", supported_parameters: ["tools"] }] }));
        }
        bodies.push(JSON.parse(init!.body as string));
        round++;
        if (round === 1) {
          // The tool call arrives in pieces, as it streams.
          return new Response(
            sse(
              { choices: [{ delta: { content: "Let me look." } }] },
              { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"pa' } }] } }] },
              { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] }, finish_reason: "tool_calls" }] },
              { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
              "data: [DONE]",
            ),
          );
        }
        return new Response(sse({ choices: [{ delta: { content: "It says hi." }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 20, completion_tokens: 4 } }, "data: [DONE]"));
      }),
    );
    const run = vi.fn(async () => ({ text: "hi" }));
    const activity: string[] = [];
    const on: TurnHandlers = { text: () => {}, thinking: () => {}, activity: (l) => activity.push(l), session: () => {} };
    const r = await streamOpenRouter({
      apiKey: "k",
      model: "acme/tooly",
      effort: "low",
      system: "",
      messages: [{ role: "user", content: "What's in a.ts?" }],
      showThinking: false,
      signal: new AbortController().signal,
      on,
      tooling: { web: true, tools: [{ name: "read_file", description: "Read", parameters: schema, run, label: (a) => `Read ${a.path}` }] },
    });
    expect(r.error).toBeUndefined();
    expect(r.text).toBe("Let me look.\n\nIt says hi.");
    expect(r.usage).toMatchObject({ inputTokens: 30, outputTokens: 9 });
    expect(run).toHaveBeenCalledWith({ path: "a.ts" });
    expect(activity).toEqual(["Read a.ts"]);
    expect(bodies[0].plugins).toEqual([{ id: "web" }]);
    expect((bodies[0].tools as { function: { name: string } }[])[0].function.name).toBe("read_file");
    const second = bodies[1].messages as Record<string, unknown>[];
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] });
    expect(second.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: "hi" });
  });

  it("full access: files anywhere, writing included, and Claude Code's own MCP servers by name", async () => {
    native.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "ai_cli_mcp_list") {
        return [
          { name: "Roblox_Studio", transport: "stdio", enabled: true },
          { name: "old", transport: "sse", enabled: true },
          { name: "mine", transport: "stdio", enabled: true },
        ];
      }
      if (cmd === "ai_mcp_tools") return [{ name: args.cliServer ? "list_studios" : "ping", description: "", inputSchema: { type: "object", properties: {} } }];
      if (cmd === "ai_mcp_call") return { text: `called ${String(args.cliServer ?? (args.server as { name: string }).name)}`, isError: false };
      if (cmd === "ai_file_tool") return `${String(args.tool)} full=${String(args.full)} write=${String(args.write)}`;
      throw new Error(cmd);
    });
    const mine = { id: "m", name: "mine", transport: "stdio" as const, command: "node", args: [], env: {}, url: "", headers: {}, enabled: true, autoAttach: false, createdAt: "" };
    const notes: string[] = [];
    const t = await apiTooling({ mode: "full", folder: undefined, web: false, workspaceId: "w" }, [mine], (l) => notes.push(l));
    const names = t.tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["list_files", "read_file", "search_files", "write_file", "edit_file", "mine__ping", "Roblox_Studio__list_studios"]));
    // SSE servers can't be used by API models; a Skele server of the same name wins.
    expect(names.some((n) => n.startsWith("old__"))).toBe(false);
    expect(names.filter((n) => n.startsWith("mine__"))).toHaveLength(1);
    expect(t.tools.find((x) => x.name === "read_file")!.description).toMatch(/absolute/);
    const write = await t.tools.find((x) => x.name === "write_file")!.run({ path: "C:/x.txt", content: "" });
    expect(write.text).toBe("write_file full=true write=true");
    expect((await t.tools.find((x) => x.name === "Roblox_Studio__list_studios")!.run({})).text).toBe("called Roblox_Studio");
    expect(native.invoke).toHaveBeenCalledWith("ai_mcp_call", { cliServer: "Roblox_Studio", tool: "list_studios", args: {} });
    expect(notes).toEqual([]);

    // Other modes never reach Claude Code's servers.
    native.invoke.mockClear();
    const read = await apiTooling({ mode: "read", folder: "/p", web: false, workspaceId: "w" }, [], () => {});
    expect(read.tools.map((x) => x.name)).toEqual(["list_files", "read_file", "search_files"]);
    expect(native.invoke).not.toHaveBeenCalledWith("ai_cli_mcp_list", expect.anything());
  });

  it("keeps a request under the provider's tool limit", async () => {
    native.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_mcp_tools") return Array.from({ length: 100 }, (_, i) => ({ name: `t${i}`, description: "", inputSchema: { type: "object" } }));
      return [];
    });
    const server = (name: string) => ({ id: name, name, transport: "stdio" as const, command: "x", args: [], env: {}, url: "", headers: {}, enabled: true, autoAttach: false, createdAt: "" });
    const notes: string[] = [];
    const t = await apiTooling({ mode: "chat", web: false, workspaceId: "w" }, [server("a"), server("b")], (l) => notes.push(l));
    expect(t.tools).toHaveLength(MAX_API_TOOLS);
    expect(notes[0]).toMatch(/72 MCP tools were left out/);
  });
});
