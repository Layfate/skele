"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, ExternalLink, FolderOpen, LayoutGrid, Pencil, Plus, Server, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { desktopInfo, isDesktop } from "@/lib/desktop";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/features/settings/components/settings-page";
import {
  cliMcpServers,
  deleteMcpServer,
  fromPreset,
  MCP_PRESETS,
  parseMcpJson,
  saveMcpServer,
  testMcpServer,
  validateMcpServer,
  type McpPreset,
  type McpTestResult,
} from "../../extensions";
import { aiKeys, useMcpServers } from "../../hooks";
import { pickFolder } from "../../providers/cli";
import type { AiSettings, McpServer } from "../../types";
import { Confirm, DesktopOnly, joinArgs, KeyValueEditor, splitArgs, StatusLine } from "./shared";

type Draft = Omit<McpServer, "id" | "createdAt"> & { id?: string };

const blank = (): Draft => ({
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  env: {},
  url: "",
  headers: {},
  enabled: true,
  autoAttach: false,
});

function useSaveServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveMcpServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.mcp }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function McpTab({ settings }: { settings: AiSettings }) {
  const servers = useMcpServers();
  const save = useSaveServer();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [presets, setPresets] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<McpServer | null>(null);
  const [tests, setTests] = useState<Record<string, McpTestResult | "running">>({});

  if (!isDesktop()) return <DesktopOnly what="MCP servers" />;
  const list = servers.data ?? [];

  const test = async (s: McpServer) => {
    setTests((t) => ({ ...t, [s.id]: "running" }));
    const result = await testMcpServer(s).catch((e): McpTestResult => ({ ok: false, tools: [], error: errorMessage(e), authRequired: false }));
    setTests((t) => ({ ...t, [s.id]: result }));
  };

  return (
    <>
      <SettingsCard
        title="MCP servers"
        description="Tools from MCP servers (files, web, GitHub, databases…) for Claude Code and Codex. Turn a server on for a chat with the shield button below the message box. Skele passes servers to the CLIs per chat and never edits their own config."
      >
        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <Server className="mx-auto mb-2 size-5" strokeWidth={1.75} />
            No servers yet. Start with one from the list.
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {list.map((s) => {
              const t = tests[s.id];
              return (
                <div key={s.id} className="space-y-2 px-3 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {s.name}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground uppercase">{s.transport}</span>
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground" title={s.transport === "stdio" ? joinArgs([s.command, ...s.args]) : s.url}>
                        {s.transport === "stdio" ? joinArgs([s.command, ...s.args]) : s.url}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button variant="ghost" size="sm" onClick={() => void test(s)} disabled={t === "running"}>
                        <Zap className="size-3.5" /> Test
                      </Button>
                      <button
                        type="button"
                        aria-label={`Edit ${s.name}`}
                        onClick={() => setEditing({ ...s })}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${s.name}`}
                        onClick={() => setToDelete(s)}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                    <label className="flex items-center gap-2">
                      <Switch checked={s.enabled} onCheckedChange={(enabled) => save.mutate({ ...s, enabled })} className="scale-90" />
                      Available to chats
                    </label>
                    <label className={cn("flex items-center gap-2", !s.enabled && "opacity-50")}>
                      <Switch checked={s.autoAttach} disabled={!s.enabled} onCheckedChange={(autoAttach) => save.mutate({ ...s, autoAttach })} className="scale-90" />
                      On in new chats
                    </label>
                  </div>
                  {t === "running" && <StatusLine tone="busy">Connecting… (the first start can take a minute while npx or uvx downloads it)</StatusLine>}
                  {t && t !== "running" &&
                    (t.ok ? (
                      <StatusLine tone="ok">
                        Connected{t.server ? ` to ${t.server}${t.version ? ` ${t.version}` : ""}` : ""}
                        {t.tools.length ? ` · ${t.tools.length} tool${t.tools.length === 1 ? "" : "s"}: ${t.tools.slice(0, 8).join(", ")}${t.tools.length > 8 ? "…" : ""}` : ""}
                      </StatusLine>
                    ) : (
                      <StatusLine tone="bad">
                        <span className="whitespace-pre-wrap">{t.error ?? "Couldn't connect."}</span>
                      </StatusLine>
                    ))}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPresets(true)}>
            <LayoutGrid className="size-3.5" /> Add from list
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing(blank())}>
            <Plus className="size-3.5" /> Custom server
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <ClipboardPaste className="size-3.5" /> Paste JSON
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Servers run on this computer with your permissions, so only add ones you trust. Their secrets (keys, tokens) are stored on this device,
          outside your workspaces.
        </p>
      </SettingsCard>

      <CliServers tool="claude" label="Claude Code" settings={settings} />
      <CliServers tool="codex" label="Codex" settings={settings} />

      {editing && (
        <ServerDialog
          draft={editing}
          others={list}
          onClose={() => setEditing(null)}
          onSave={(d) =>
            save.mutate(d, {
              onSuccess: () => {
                setEditing(null);
                toast.success(`Saved ${d.name}`);
              },
            })
          }
        />
      )}
      <PresetDialog
        open={presets}
        existing={list}
        onClose={() => setPresets(false)}
        onAdd={(d) =>
          save.mutate(d, {
            onSuccess: (saved) => {
              setPresets(false);
              toast.success(`Added ${saved.name}. Testing it…`);
              void test(saved);
            },
          })
        }
      />
      <ImportDialog
        open={importing}
        existing={list}
        onClose={() => setImporting(false)}
        onImport={async (drafts) => {
          let added = 0;
          for (const d of drafts) {
            try {
              await saveMcpServer(d);
              added++;
            } catch (e) {
              toast.error(`${d.name}: ${errorMessage(e)}`);
            }
          }
          await qc.invalidateQueries({ queryKey: aiKeys.mcp });
          if (added) toast.success(`Added ${added} server${added === 1 ? "" : "s"}`);
          setImporting(false);
        }}
      />
      <Confirm
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Remove ${toDelete?.name}?`}
        description="Chats that use it lose its tools. This doesn't uninstall anything from your computer."
        action="Remove"
        onConfirm={async () => {
          const id = toDelete!.id;
          setToDelete(null);
          await deleteMcpServer(id).catch((e) => toast.error(errorMessage(e)));
          await qc.invalidateQueries({ queryKey: aiKeys.mcp });
        }}
      />
    </>
  );
}

function CliServers({ tool, label, settings }: { tool: "claude" | "codex"; label: string; settings: AiSettings }) {
  const q = useQuery({
    queryKey: ["ai-cli-mcp", tool],
    queryFn: () => cliMcpServers(tool, tool === "claude" ? settings.claudePath : settings.codexPath),
    staleTime: 60_000,
    retry: false,
  });
  if (q.isPending || (q.data && q.data.length === 0)) return null;
  return (
    <SettingsCard
      title={`Set up in ${label}`}
      description={
        settings.useCliExtensions
          ? `Chats also use these (the "Use Claude Code's and Codex's own extensions" setting is on).`
          : `Configured in ${label} itself. Chats don't use them unless you turn on "Use Claude Code's and Codex's own extensions" under Providers.`
      }
    >
      {q.isError ? (
        <StatusLine tone="bad">{q.error.message}</StatusLine>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {q.data!.map((s) => (
            <li key={s.name} className="flex items-baseline gap-2">
              <span className={cn("font-medium", !s.enabled && "text-muted-foreground line-through")}>{s.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {s.url ?? [s.command, ...(s.args ?? [])].filter(Boolean).join(" ")}
                {s.envKeys?.length ? ` · env: ${s.envKeys.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function ServerDialog({ draft, others, onClose, onSave }: { draft: Draft; others: McpServer[]; onClose: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [line, setLine] = useState(() => joinArgs([draft.command, ...draft.args].filter((x, i) => i > 0 || x)));
  const apply = (): Draft => {
    if (d.transport !== "stdio") return { ...d, command: "", args: [] };
    const [command = "", ...args] = splitArgs(line);
    return { ...d, command, args, url: "", headers: {} };
  };
  const error = validateMcpServer(apply(), others, d.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft.id ? `Edit ${draft.name}` : "Add an MCP server"}</DialogTitle>
          <DialogDescription>A local program (stdio) or a server on the web (HTTP).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input id="mcp-name" value={d.name} spellCheck={false} placeholder="e.g. files" onChange={(e) => setD({ ...d, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={d.transport} onValueChange={(transport) => setD({ ...d, transport: transport as Draft["transport"] })}>
                <SelectTrigger aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">Local (stdio)</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="sse">SSE (older)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {d.transport === "stdio" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  value={line}
                  spellCheck={false}
                  placeholder="npx -y @modelcontextprotocol/server-memory"
                  onChange={(e) => setLine(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">The program and its arguments. Quote arguments that contain spaces.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Environment variables</Label>
                <KeyValueEditor value={d.env} onChange={(env) => setD({ ...d, env })} keyPlaceholder="API_KEY" valuePlaceholder="value" secret addLabel="Add variable" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-url">URL</Label>
                <Input id="mcp-url" value={d.url} spellCheck={false} placeholder="https://example.com/mcp" onChange={(e) => setD({ ...d, url: e.target.value })} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label>Headers</Label>
                <KeyValueEditor value={d.headers} onChange={(headers) => setD({ ...d, headers })} keyPlaceholder="Authorization" valuePlaceholder="Bearer …" secret addLabel="Add header" />
                <p className="text-xs text-muted-foreground">Servers that sign in with OAuth: sign in once with `claude mcp login` or `codex mcp login`.</p>
              </div>
            </>
          )}
        </div>
        <DialogFooter className="items-center">
          {error && <p className="mr-auto text-xs text-muted-foreground">{error}</p>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!error} onClick={() => onSave(apply())}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PresetDialog({ open, existing, onClose, onAdd }: { open: boolean; existing: McpServer[]; onClose: () => void; onAdd: (d: Draft) => void }) {
  const [preset, setPreset] = useState<McpPreset | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [folder, setFolder] = useState<string | null>(null);
  const reset = () => {
    setPreset(null);
    setValues({});
    setFolder(null);
  };
  const add = async () => {
    if (!preset) return;
    const os = (await desktopInfo())?.os;
    let draft = fromPreset(preset, values, folder, os);
    // Keep names unique ("files", "files-2", …).
    let n = 2;
    while (existing.some((s) => s.name === draft.name)) draft = { ...draft, name: `${preset.name}-${n++}` };
    onAdd(draft);
    reset();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{preset ? preset.title : "Add an MCP server"}</DialogTitle>
          <DialogDescription>{preset ? preset.description : "Well-known servers, ready to use."}</DialogDescription>
        </DialogHeader>
        {!preset ? (
          <div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2 scrollbar-thin">
            {MCP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p)}
                className="rounded-lg border p-3 text-left text-sm hover:border-brand/40 hover:bg-accent"
              >
                <span className="flex items-center gap-2 font-medium">
                  {p.title}
                  {existing.some((s) => s.preset === p.id) && <span className="text-xs font-normal text-brand">added</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{p.description}</span>
                <span className="mt-1.5 block text-[11px] text-muted-foreground/80">{p.requires ? `Needs ${p.requires}` : "Hosted"}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="rounded-md bg-muted/60 px-3 py-2 font-mono text-xs break-all">
              {preset.transport === "stdio" ? joinArgs([preset.command ?? "", ...(preset.args ?? []).map((a) => (a === "{folder}" ? folder ?? "<folder>" : a))]) : preset.url}
            </p>
            {preset.needsFolder && (
              <div className="space-y-1.5">
                <Label>Folder</Label>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{folder ?? "No folder chosen"}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const f = await pickFolder();
                        if (f) setFolder(f);
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    <FolderOpen className="size-3.5" /> Choose…
                  </Button>
                </div>
              </div>
            )}
            {preset.fields?.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                <Input
                  id={`f-${f.key}`}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            ))}
            {preset.requires && <p className="text-xs text-muted-foreground">Needs {preset.requires} on this computer. The server is downloaded the first time it starts.</p>}
            <a href={preset.docs} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
              <ExternalLink className="size-3" /> About this server
            </a>
          </div>
        )}
        {preset && (
          <DialogFooter>
            <Button variant="outline" onClick={reset}>
              Back
            </Button>
            <Button onClick={() => void add()} disabled={!!preset.needsFolder && !folder}>
              Add
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  existing,
  onClose,
  onImport,
}: {
  open: boolean;
  existing: McpServer[];
  onClose: () => void;
  onImport: (drafts: Draft[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  let parsed: Draft[] = [];
  let error = "";
  if (text.trim()) {
    try {
      parsed = parseMcpJson(text);
    } catch (e) {
      error = e instanceof SyntaxError ? "That isn't valid JSON." : errorMessage(e);
    }
  }
  const taken = new Set(existing.map((s) => s.name));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setText("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste MCP server JSON</DialogTitle>
          <DialogDescription>From a server&apos;s README, Claude Desktop, Cursor or VS Code: the whole config or just its &quot;mcpServers&quot; part.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          spellCheck={false}
          placeholder={'{\n  "mcpServers": {\n    "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }\n  }\n}'}
          className="font-mono text-xs"
        />
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          parsed.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {parsed.map((p) => (
                <li key={p.name}>
                  <span className="font-medium text-foreground">{p.name}</span> · {p.transport === "stdio" ? joinArgs([p.command, ...p.args]) : p.url}
                  {taken.has(p.name) && <span className="text-destructive"> · a server with this name exists</span>}
                </li>
              ))}
            </ul>
          )
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!parsed.length || busy}
            onClick={async () => {
              setBusy(true);
              await onImport(parsed.filter((p) => !taken.has(p.name)));
              setBusy(false);
              setText("");
            }}
          >
            Add {parsed.filter((p) => !taken.has(p.name)).length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
