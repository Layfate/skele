"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  CircleCheckBig,
  Clock,
  FilePlus2,
  FileStack,
  FolderKanban,
  FolderPlus,
  Hash,
  House,
  ListPlus,
  Loader2,
  Moon,
  Network,
  PanelLeft,
  Settings,
  Sun,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ColorDot, IconTile, PageIcon } from "@/components/common";
import { routes } from "@/lib/routes";
import { errorMessage } from "@/lib/errors";
import { useUI } from "@/stores/ui";
import { search } from "@/data/repo/search";
import { createFromTemplate, listTemplates, openDailyNote } from "@/data/repo/pages";
import { pageKeys, useCreatePage, useRecent } from "@/features/pages/hooks";
import { useCreateTask } from "@/features/projects/hooks";
import { usePreferences, useUpdatePreferences } from "@/features/settings/hooks";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useOpenWorkspace, useWorkspaces } from "@/features/workspaces/hooks";
import { Highlight } from "./highlight";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette() {
  const open = useUI((s) => s.commandOpen);
  const setOpen = useUI((s) => s.setCommandOpen);
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search notes, tasks and commands" className="sm:max-w-xl">
      {/* Mounted only while open, so the query resets every time the palette opens. */}
      {open && <PaletteBody close={() => setOpen(false)} />}
    </CommandDialog>
  );
}

type Cmd = { id: string; label: string; icon: LucideIcon; action: () => void; shortcut?: string; keywords?: string };

function PaletteBody({ close }: { close: () => void }) {
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const router = useRouter();
  const qc = useQueryClient();
  const { workspaceId, store } = useWorkspaceCtx();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 120);
  const recent = useRecent(workspaceId);
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const createPage = useCreatePage(workspaceId);
  const createTask = useCreateTask(workspaceId);
  const workspaces = useWorkspaces();
  const openWorkspace = useOpenWorkspace();
  const templates = useQuery({ queryKey: ["templates", workspaceId], queryFn: () => listTemplates(store) });

  const results = useQuery({
    queryKey: ["search", workspaceId, q],
    queryFn: () => search(store, q),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
    staleTime: 2_000,
  });

  const run = (fn: () => void) => {
    if (q) {
      const prev = prefs.data?.recentSearches ?? [];
      updatePrefs.mutate({ recentSearches: [q, ...prev.filter((s) => s !== q)].slice(0, 6) });
    }
    close();
    fn();
  };
  const go = (href: string) => run(() => router.push(href));

  const commands = useMemo<Cmd[]>(
    () => [
      { id: "new-page", label: "New page", icon: FilePlus2, action: () => createPage.mutate({}), keywords: "note create" },
      {
        id: "daily",
        label: "Open today's daily note",
        icon: CalendarPlus,
        keywords: "journal daily",
        action: async () => {
          try {
            const page = await openDailyNote(store);
            qc.invalidateQueries({ queryKey: pageKeys.list(workspaceId) });
            router.push(routes.page(page.id));
          } catch (e) {
            toast.error(errorMessage(e));
          }
        },
      },
      { id: "new-db", label: "New database", icon: Table2, action: () => createPage.mutate({ kind: "DATABASE", title: "Untitled database" }) },
      { id: "new-project", label: "New project", icon: FolderPlus, action: () => router.push(routes.newProject) },
      { id: "home", label: "Go to Home", icon: House, action: () => router.push(routes.home) },
      { id: "tasks", label: "Go to My tasks", icon: CircleCheckBig, action: () => router.push(routes.tasks) },
      { id: "projects", label: "Go to Projects", icon: FolderKanban, action: () => router.push(routes.projects) },
      { id: "databases", label: "Go to Databases", icon: Table2, action: () => router.push(routes.databases) },
      { id: "calendar", label: "Go to Calendar", icon: CalendarDays, action: () => router.push(routes.calendar) },
      { id: "graph", label: "Open graph view", icon: Network, action: () => router.push(routes.graph), keywords: "links connections" },
      { id: "settings", label: "Open settings", icon: Settings, action: () => router.push(routes.settings()) },
      {
        id: "theme",
        label: resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        icon: resolvedTheme === "dark" ? Sun : Moon,
        keywords: "theme appearance",
        action: () => {
          const theme = resolvedTheme === "dark" ? "light" : "dark";
          setTheme(theme);
          updatePrefs.mutate({ theme });
        },
      },
      { id: "sidebar", label: "Toggle sidebar", icon: PanelLeft, action: toggleSidebar, shortcut: "Ctrl \\" },
    ],
    [createPage, qc, resolvedTheme, router, setTheme, store, toggleSidebar, updatePrefs, workspaceId],
  );

  const ql = q.toLowerCase();
  const filteredCommands = q ? commands.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(ql)) : commands;
  const otherWorkspaces = (workspaces.data ?? []).filter((w) => w.id !== workspaceId && (!q || w.name.toLowerCase().includes(ql)));
  const matchingTemplates = (templates.data ?? []).filter((t) => !q || t.title.toLowerCase().includes(ql) || "template".includes(ql));
  const r = q ? results.data : undefined;
  const recentSearches = (prefs.data?.recentSearches ?? []).slice(0, 4);

  // Results arrive asynchronously, so keep the highlighted item on the first result.
  const firstValue = r?.pages[0]
    ? `page-${r.pages[0].id}`
    : r?.records[0]
      ? `rec-${r.records[0].id}`
      : r?.tasks[0]
        ? `task-${r.tasks[0].id}`
        : r?.projects[0]
          ? `project-${r.projects[0].id}`
          : q && !q.startsWith("#")
            ? "create-task"
            : filteredCommands[0]
              ? `cmd-${filteredCommands[0].id}`
              : "";
  const [selected, setSelected] = useState("");
  const [lastFirst, setLastFirst] = useState("");
  if (firstValue !== lastFirst) {
    setLastFirst(firstValue);
    if (firstValue) setSelected(firstValue);
  }

  return (
    <Command shouldFilter={false} loop value={selected} onValueChange={setSelected}>
      <CommandInput placeholder="Search notes, tasks, #tags or run a command…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[min(60vh,460px)]">
        {q && results.isFetching && !r && (
          <div className="flex items-center gap-2 px-3 py-4 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Searching…
          </div>
        )}
        <CommandEmpty>No results.</CommandEmpty>

        {!q && recentSearches.length > 0 && (
          <CommandGroup heading="Recent searches">
            {recentSearches.map((s) => (
              <CommandItem key={s} value={`recent-search-${s}`} onSelect={() => setQuery(s)}>
                <Clock />
                {s}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!q && !!recent.data?.length && (
          <CommandGroup heading="Recently opened">
            {recent.data.slice(0, 6).map((p) => (
              <CommandItem key={p.id} value={`recent-${p.id}`} onSelect={() => go(routes.page(p.id))}>
                <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-[15px]" />
                <span className="truncate">{p.title || "Untitled"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {r && r.pages.length > 0 && (
          <CommandGroup heading="Notes">
            {r.pages.map((p) => (
              <CommandItem key={p.id} value={`page-${p.id}`} onSelect={() => go(routes.page(p.id))}>
                <PageIcon icon={p.icon} kind={p.kind} className="size-4 self-start pt-0.5 text-[15px]" />
                <div className="min-w-0">
                  <Highlight text={p.title || "Untitled"} query={q} className="block truncate" />
                  {p.snippet && <Highlight text={p.snippet} query={q} className="line-clamp-1 text-xs text-muted-foreground" />}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r && r.tags.length > 0 && (
          <CommandGroup heading="Tags">
            {r.tags.map((t) => (
              <CommandItem key={t} value={`tag-${t}`} onSelect={() => setQuery(`#${t}`)}>
                <Hash />
                {t}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r && r.records.length > 0 && (
          <CommandGroup heading="Database records">
            {r.records.map((rec) => (
              <CommandItem key={rec.id} value={`rec-${rec.id}`} onSelect={() => go(routes.record(rec.pageId, rec.id))}>
                <PageIcon icon={rec.icon} className="size-4 text-[15px]" />
                <Highlight text={rec.title || "Untitled"} query={q} className="truncate" />
                <span className="ml-auto truncate text-xs text-muted-foreground">{rec.databaseTitle || "Untitled"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r && r.tasks.length > 0 && (
          <CommandGroup heading="Tasks">
            {r.tasks.map((t) => (
              <CommandItem key={t.id} value={`task-${t.id}`} onSelect={() => go(routes.task(t.id))}>
                <CircleCheckBig className={t.status === "COMPLETED" ? "text-brand" : ""} />
                <Highlight text={t.title} query={q} className="truncate" />
                {t.projectName && <span className="ml-auto truncate text-xs text-muted-foreground">{t.projectName}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r && r.projects.length > 0 && (
          <CommandGroup heading="Projects">
            {r.projects.map((p) => (
              <CommandItem key={p.id} value={`project-${p.id}`} onSelect={() => go(routes.project(p.id))}>
                {p.icon ? <span className="w-4 text-center">{p.icon}</span> : <ColorDot color={p.color} className="mx-1" />}
                <Highlight text={p.name} query={q} className="truncate" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {q && !q.startsWith("#") && (
          <CommandGroup heading="Create">
            <CommandItem
              value="create-task"
              onSelect={() => run(() => createTask.mutate({ title: q }, { onSuccess: (t) => toast.success(`Task added: ${t.title}`) }))}
            >
              <ListPlus /> Create task “{q}”
            </CommandItem>
            <CommandItem value="create-page" onSelect={() => run(() => createPage.mutate({ title: q }))}>
              <FilePlus2 /> Create page “{q}”
            </CommandItem>
          </CommandGroup>
        )}
        {matchingTemplates.length > 0 && (
          <CommandGroup heading="New from template">
            {matchingTemplates.slice(0, 5).map((t) => (
              <CommandItem
                key={t.id}
                value={`template-${t.id}`}
                onSelect={() =>
                  run(async () => {
                    const page = await createFromTemplate(store, t.id);
                    qc.invalidateQueries({ queryKey: pageKeys.list(workspaceId) });
                    router.push(routes.page(page.id));
                  })
                }
              >
                <FileStack /> {t.title || "Untitled template"}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {filteredCommands.length > 0 && (
          <CommandGroup heading="Commands">
            {filteredCommands.map((c) => (
              <CommandItem key={c.id} value={`cmd-${c.id}`} onSelect={() => run(c.action)}>
                <c.icon />
                {c.label}
                {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {otherWorkspaces.length > 0 && (
          <CommandGroup heading="Switch workspace">
            {otherWorkspaces.map((w) => (
              <CommandItem
                key={w.id}
                value={`ws-${w.id}`}
                onSelect={() => run(() => openWorkspace.mutate(w.id, { onSuccess: () => router.push(routes.home) }))}
              >
                <IconTile icon={w.icon} name={w.name} color={w.color} className="size-5 text-[11px]" />
                <Highlight text={w.name} query={q} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>#tag to filter</span>
        <span>esc close</span>
      </div>
    </Command>
  );
}
