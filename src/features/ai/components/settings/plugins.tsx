"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Puzzle, RefreshCw, Search, Store, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import { isDesktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { captureError, cliManage, listMarketplaces, listPlugins, pendingCommand, type ManageAction, type Plugin } from "../../extensions";
import type { CliTool } from "../../providers/cli";
import type { AiSettings } from "../../types";
import { Confirm, DesktopOnly, StatusLine } from "./shared";
import { useCliStatus } from "./providers";

const LABEL: Record<CliTool, string> = { claude: "Claude Code", codex: "Codex" };

export function PluginsTab({ settings }: { settings: AiSettings }) {
  const status = useCliStatus(settings);
  const installed = (status.data ?? []).filter((s) => (s.tool === "claude" || s.tool === "codex") && s.path).map((s) => s.tool as CliTool);
  const [picked, setPicked] = useState<CliTool | null>(null);
  if (!isDesktop()) return <DesktopOnly what="Plugins" />;
  if (status.isPending) return <StatusLine tone="busy">Looking for Claude Code and Codex…</StatusLine>;
  if (!installed.length) return <SettingsCard title="Plugins"><p className="text-sm text-muted-foreground">Install Claude Code or Codex first (see Providers).</p></SettingsCard>;
  const tool = picked && installed.includes(picked) ? picked : installed[0];
  return (
    <>
      {installed.length > 1 && (
        <div className="mb-4 inline-flex rounded-lg bg-muted p-[3px]" role="tablist" aria-label="Tool">
          {installed.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tool}
              onClick={() => setPicked(t)}
              className={cn("h-7 rounded-md px-3 text-sm text-muted-foreground", t === tool && "bg-background font-medium text-foreground shadow-sm")}
            >
              {LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <ToolPlugins key={tool} tool={tool} path={tool === "claude" ? settings.claudePath : settings.codexPath} cliExtensions={settings.useCliExtensions} />
    </>
  );
}

function ToolPlugins({ tool, path, cliExtensions }: { tool: CliTool; path: string; cliExtensions: boolean }) {
  const qc = useQueryClient();
  const plugins = useQuery({ queryKey: ["ai-plugins", tool], queryFn: () => listPlugins(tool, path), staleTime: 5 * 60_000, retry: false });
  const markets = useQuery({ queryKey: ["ai-marketplaces", tool], queryFn: () => listMarketplaces(tool, path), staleTime: 5 * 60_000, retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [confirm, setConfirm] = useState<{ id: string; command: string; sha256: string } | null>(null);
  const [remove, setRemove] = useState<Plugin | null>(null);
  const [removeMarket, setRemoveMarket] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["ai-plugins", tool] });
    void qc.invalidateQueries({ queryKey: ["ai-marketplaces", tool] });
    void qc.invalidateQueries({ queryKey: ["ai-skills"] });
  };

  /** Runs one management command; true when it worked. */
  const run = async (key: string, action: ManageAction, what: string, done?: string): Promise<boolean> => {
    setBusy(key);
    try {
      const out = await cliManage(tool, action, path);
      if (!out.ok) {
        const pending = action.action === "pluginInstall" ? pendingCommand(out) : null;
        if (pending && action.action === "pluginInstall") {
          setConfirm({ id: action.id, ...pending });
          return false;
        }
        throw new Error(captureError(out, what));
      }
      if (done) toast.success(done);
      refresh();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = plugins.data?.available ?? [];
    return q ? list.filter((p) => `${p.name} ${p.description ?? ""} ${p.marketplaceName ?? ""}`.toLowerCase().includes(q)) : list;
  }, [plugins.data, query]);

  return (
    <>
      <SettingsCard
        title={`Installed in ${LABEL[tool]}`}
        description={
          cliExtensions
            ? `Plugins add skills, agents, commands and MCP servers to ${LABEL[tool]}. Chats use them because "Use Claude Code's and Codex's own extensions" is on.`
            : `Plugins add skills, agents, commands and MCP servers to ${LABEL[tool]}. For chats to use them, turn on "Use Claude Code's and Codex's own extensions" under Providers.`
        }
      >
        {plugins.isPending ? (
          <StatusLine tone="busy">Loading plugins…</StatusLine>
        ) : plugins.isError ? (
          <StatusLine tone="bad">{plugins.error.message}</StatusLine>
        ) : plugins.data.installed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plugins installed yet.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {plugins.data.installed.map((p) => (
              <div key={p.pluginId} className="flex items-center gap-3 px-3 py-2.5">
                <Puzzle className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">
                    {p.name} {p.version && <span className="font-normal text-muted-foreground">{p.version}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{p.description || p.marketplaceName}</p>
                </div>
                {tool === "claude" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void run(`u:${p.pluginId}`, { action: "pluginUpdate", id: p.pluginId }, "Updating", `Updated ${p.name}. Restart running sessions to use it.`)}
                    >
                      <RefreshCw className={cn("size-3.5", busy === `u:${p.pluginId}` && "animate-spin")} />
                      <span className="sr-only sm:not-sr-only">Update</span>
                    </Button>
                    <Switch
                      checked={p.enabled !== false}
                      disabled={!!busy}
                      aria-label={`${p.name} enabled`}
                      onCheckedChange={(on) =>
                        void run(`e:${p.pluginId}`, { action: on ? "pluginEnable" : "pluginDisable", id: p.pluginId }, on ? "Enabling" : "Disabling")
                      }
                    />
                  </>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  disabled={!!busy}
                  onClick={() => setRemove(p)}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Browse" description="Plugins from the marketplaces below. Install only plugins you trust: they run on this computer.">
        <label className="mb-3 flex h-8 items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plugins"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {plugins.isPending ? (
          <StatusLine tone="busy">Loading…</StatusLine>
        ) : plugins.isError ? (
          <StatusLine tone="bad">Couldn&apos;t load the marketplaces&apos; plugins: {plugins.error.message}</StatusLine>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">{query ? "No matching plugins." : "Nothing else to install. Add a marketplace below."}</p>
        ) : (
          <div className="max-h-96 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
            {available.slice(0, 200).map((p) => (
              <div key={p.pluginId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">
                    {p.name} <span className="font-normal text-muted-foreground">{p.marketplaceName}</span>
                  </p>
                  {p.description && <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void run(`i:${p.pluginId}`, { action: "pluginInstall", id: p.pluginId }, "Installing", `Installed ${p.name}`)}
                >
                  <Download className={cn("size-3.5", busy === `i:${p.pluginId}` && "animate-bounce")} />
                  {busy === `i:${p.pluginId}` ? "Installing…" : "Install"}
                </Button>
              </div>
            ))}
          </div>
        )}
        {available.length > 200 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing 200 of {available.length.toLocaleString()} plugins. Search to find the others.
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Marketplaces" description="Where plugins come from: a GitHub repository (owner/repo), a Git URL, or a folder.">
        {markets.isPending ? (
          <StatusLine tone="busy">Loading…</StatusLine>
        ) : markets.isError ? (
          <StatusLine tone="bad">{markets.error.message}</StatusLine>
        ) : (
          <ul className="mb-3 space-y-1.5 text-sm">
            {markets.data.length === 0 && <li className="text-muted-foreground">None added.</li>}
            {markets.data.map((m) => (
              <li key={m.name} className="flex items-center gap-2">
                <Store className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="font-medium">{m.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{m.repo ?? m.url ?? m.path ?? m.source}</span>
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  disabled={!!busy}
                  onClick={() => setRemoveMarket(m.name)}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            placeholder={tool === "claude" ? "anthropics/claude-plugins-official" : "owner/repo"}
            className="h-8 font-mono text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && source.trim()) void run("m:add", { action: "marketplaceAdd", source: source.trim() }, "Adding the marketplace", "Marketplace added").then((ok) => ok && setSource(""));
            }}
          />
          <Button
            size="sm"
            disabled={!source.trim() || !!busy}
            onClick={() => void run("m:add", { action: "marketplaceAdd", source: source.trim() }, "Adding the marketplace", "Marketplace added").then((ok) => ok && setSource(""))}
          >
            {busy === "m:add" ? "Adding…" : "Add"}
          </Button>
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void run("m:update", { action: "marketplaceUpdate" }, "Updating marketplaces", "Marketplaces updated")}>
            <RefreshCw className={cn("size-3.5", busy === "m:update" && "animate-spin")} />
            <span className="sr-only sm:not-sr-only">Update</span>
          </Button>
        </div>
      </SettingsCard>

      <Confirm
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Run the marketplace's install command?"
        destructive={false}
        description={
          <div className="space-y-2">
            <p>This plugin&apos;s marketplace runs a command on your computer to install it:</p>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{confirm?.command}</pre>
            <p>Only continue if you trust where it comes from.</p>
          </div>
        }
        action="Run and install"
        onConfirm={() => {
          const c = confirm!;
          setConfirm(null);
          void run(`i:${c.id}`, { action: "pluginInstall", id: c.id, acceptCommand: c.sha256 }, "Installing", "Installed");
        }}
      />
      <Confirm
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={`Remove ${remove?.name}?`}
        description={`It's uninstalled from ${LABEL[tool]}.`}
        action="Remove"
        onConfirm={() => {
          const p = remove!;
          setRemove(null);
          void run(`r:${p.pluginId}`, { action: "pluginUninstall", id: p.pluginId }, "Removing", `Removed ${p.name}`);
        }}
      />
      <Confirm
        open={!!removeMarket}
        onOpenChange={(o) => !o && setRemoveMarket(null)}
        title={`Remove the ${removeMarket} marketplace?`}
        description="Plugins you installed from it may be removed too."
        action="Remove"
        onConfirm={() => {
          const name = removeMarket!;
          setRemoveMarket(null);
          void run(`m:${name}`, { action: "marketplaceRemove", name }, "Removing the marketplace", "Marketplace removed");
        }}
      />
    </>
  );
}
