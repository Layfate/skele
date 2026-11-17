"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AtSign, Check, FolderOpen, Globe, MessageCircle, PencilLine, Plug, Settings2, Shield, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { checkFolder, pickFolder } from "../providers/cli";
import { PROVIDERS, type AccessMode, type Agent, type McpServer, type ProviderId } from "../types";

export type Access = { mode: AccessMode; folder?: string; web: boolean; mcp: string[] };

const MODES: { id: AccessMode; label: string; short: string; hint: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat only", short: "Chat", hint: "Talks with you. No access to files on this computer.", icon: MessageCircle },
  { id: "read", label: "Read files", short: "Read", hint: "Can read and search files in one folder you choose.", icon: ShieldCheck },
  {
    id: "edit",
    label: "Edit files",
    short: "Edit",
    hint: "Can also create and change files in that folder. Claude Code gets no shell; Codex runs commands in its sandbox; API models get Skele's file tools (no commands).",
    icon: PencilLine,
  },
];

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** What the AI may do in this chat: access mode, folder, web search and MCP servers. */
export function AccessMenu({
  provider,
  value,
  servers,
  cliExtensions,
  local = true,
  onChange,
}: {
  provider: ProviderId;
  value: Access;
  servers: McpServer[];
  /** The CLIs also use their own MCP servers, plugins and skills. */
  cliExtensions: boolean;
  /** Files and MCP servers are available (the desktop app); in a browser only web search is. */
  local?: boolean;
  onChange: (patch: Partial<Access>) => void;
}) {
  const cli = PROVIDERS[provider].kind === "cli";
  const [open, setOpen] = useState(false);
  const enabled = servers.filter((s) => s.enabled);
  const on = new Set(value.mcp);
  const active = enabled.filter((s) => on.has(s.id)).length;
  const current = MODES.find((m) => m.id === value.mode) ?? MODES[0];
  const Icon = value.mode === "edit" ? ShieldAlert : value.mode === "read" ? ShieldCheck : Shield;

  const choose = async (mode: AccessMode) => {
    if (mode === "chat" || value.folder) return onChange({ mode });
    try {
      const folder = await pickFolder();
      if (folder) onChange({ mode, folder });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const changeFolder = async () => {
    try {
      const folder = await pickFolder();
      if (folder) onChange({ folder });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const [typed, setTyped] = useState<string | null>(null);
  const [folderError, setFolderError] = useState("");
  const commitTyped = async () => {
    if (typed === null) return;
    const raw = typed.trim();
    setTyped(null);
    if (!raw || raw === value.folder) return setFolderError("");
    try {
      onChange({ folder: await checkFolder(raw) });
      setFolderError("");
    } catch (e) {
      setFolderError(errorMessage(e));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`What ${PROVIDERS[provider].label} may do in this chat`}
          aria-label={`Access: ${current.label}`}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent",
            value.mode === "edit" && "text-amber-700 dark:text-amber-400",
          )}
        >
          <Icon className="size-4" strokeWidth={1.75} />
          <span className="hidden @md:inline">{current.short}</span>
          {value.mode !== "chat" && value.folder && (
            <span className="hidden max-w-28 truncate text-xs opacity-80 @2xl:inline">· {folderName(value.folder)}</span>
          )}
          {(active > 0 || value.web) && (
            <span className="flex items-center gap-0.5 text-xs">
              {value.web && <Globe className="size-3" />}
              {active > 0 && (
                <>
                  <Plug className="size-3" />
                  {active}
                </>
              )}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        {!local && <p className="px-3 pt-2.5 text-xs text-muted-foreground">Reading files and MCP servers need the Skele desktop app.</p>}
        {local && (
        <>
        <div className="p-1.5" role="radiogroup" aria-label="Access">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === value.mode}
              onClick={() => void choose(m.id)}
              className={cn("flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent", m.id === value.mode && "bg-accent/60")}
            >
              <m.icon className={cn("mt-0.5 size-4 shrink-0", m.id === "edit" ? "text-amber-600" : "text-muted-foreground")} strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
              </span>
              <Check className={cn("mt-0.5 size-4 shrink-0", m.id !== value.mode && "invisible")} />
            </button>
          ))}
        </div>
        <div className={cn("border-t px-3 py-2 text-xs", value.mode === "chat" && "text-muted-foreground")}>
          <div className="flex items-center gap-2">
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={typed ?? value.folder ?? ""}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => void commitTyped()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitTyped();
                }
              }}
              placeholder="Folder for reading and editing"
              aria-label="Folder"
              spellCheck={false}
              className="min-w-0 flex-1 rounded bg-transparent py-0.5 font-mono outline-none placeholder:font-sans placeholder:text-muted-foreground focus:bg-muted/60"
            />
            <button type="button" onClick={() => void changeFolder()} className="shrink-0 rounded px-1.5 py-0.5 font-medium text-brand hover:bg-accent">
              Browse…
            </button>
          </div>
          {folderError && <p className="mt-1 text-destructive">{folderError}</p>}
        </div>
        </>
        )}
        <label className="flex items-center justify-between gap-3 border-t px-3 py-2.5 text-sm">
          <span className="flex items-center gap-2">
            <Globe className="size-4 text-muted-foreground" strokeWidth={1.75} />
            <span>
              <span className="block">Web search</span>
              <span className="block text-xs text-muted-foreground">
                {provider === "openrouter" ? "OpenRouter's web search (billed from your credits)" : "Search the web and read pages"}
              </span>
            </span>
          </span>
          <Switch checked={value.web} onCheckedChange={(web) => onChange({ web })} />
        </label>
        {local && (
        <div className="border-t px-1.5 py-1.5">
          <p className="flex items-center justify-between px-1.5 pb-1 text-xs font-medium text-muted-foreground">
            MCP servers
            <Link href={routes.aiSettings("mcp")} onClick={() => setOpen(false)} className="font-normal text-brand hover:underline">
              Manage
            </Link>
          </p>
          {enabled.length === 0 ? (
            <p className="px-1.5 pb-1 text-xs text-muted-foreground">None yet. Add servers in Settings → AI → MCP servers.</p>
          ) : (
            enabled.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent">
                <input
                  type="checkbox"
                  checked={on.has(s.id)}
                  onChange={(e) => onChange({ mcp: e.target.checked ? [...value.mcp, s.id] : value.mcp.filter((id) => id !== s.id) })}
                  className="size-3.5 accent-[var(--brand)]"
                />
                <span className="font-medium">{s.name}</span>
                <span className="truncate text-xs text-muted-foreground">{s.transport === "stdio" ? s.command : s.url}</span>
              </label>
            ))
          )}
          {cli && cliExtensions && (
            <p className="px-1.5 pt-1 text-xs text-muted-foreground">Also uses the MCP servers, plugins and skills set up in Claude Code and Codex.</p>
          )}
        </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The agent answering this chat by default (others can still be @mentioned). */
export function AgentMenu({ agents, agentId, onChange }: { agents: Agent[]; agentId?: string; onChange: (id: string | undefined) => void }) {
  const current = agents.find((a) => a.id === agentId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Agent answering this chat"
          className={cn(
            "flex h-8 max-w-40 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent",
            current && "text-foreground",
          )}
        >
          <AtSign className="size-4 shrink-0" strokeWidth={1.75} />
          {current && <span className="truncate">{current.name}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Answers by default</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(undefined)} className="gap-2">
          <Check className={cn("size-4", current && "invisible")} />
          No agent
        </DropdownMenuItem>
        {agents.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => onChange(a.id)} className="items-start gap-2">
            <Check className={cn("mt-0.5 size-4 shrink-0", a.id !== agentId && "invisible")} />
            <span className="min-w-0">
              <span className="block">@{a.name}</span>
              {a.description && <span className="block truncate text-xs text-muted-foreground">{a.description}</span>}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-xs text-muted-foreground">Type @name in a message to ask any agent, or several at once.</p>
        <DropdownMenuItem asChild>
          <Link href={routes.aiSettings("agents")} className="gap-2 text-muted-foreground">
            <Settings2 className="size-4" />
            Manage agents
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
