"use client";

import { routes } from "@/lib/routes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronsLeft,
  CircleCheckBig,
  FileText,
  FolderKanban,
  House,
  Network,
  Plus,
  Search,
  Settings,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd, modKey } from "@/components/common";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { usePages, useCreatePage, useRecent } from "@/features/pages/hooks";
import { PageIcon } from "@/components/common";
import { SpotifySidebarWidget } from "@/features/spotify/components/spotify-player";
import { PageTree } from "@/features/pages/components/page-tree";
import { TrashPopover } from "@/features/pages/components/trash-popover";
import { WorkspaceSwitcher } from "@/features/workspaces/components/workspace-switcher";
import { useWorkspaceCtx } from "./workspace-context";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const pathname = usePathname();
  const pages = usePages(workspaceId);
  const recent = useRecent(workspaceId);
  const create = useCreatePage(workspaceId);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const setCommandOpen = useUI((s) => s.setCommandOpen);

  const { favorites, pinned } = useMemo(() => {
    const list = pages.data?.pages ?? [];
    const byId = new Map(list.map((p) => [p.id, p]));
    return {
      favorites: (pages.data?.favoriteIds ?? []).map((id) => byId.get(id)).filter((p) => !!p),
      pinned: list.filter((p) => p.pinned),
    };
  }, [pages.data]);

  const nav: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
    { href: routes.home, label: "Home", icon: House, exact: true },
    { href: routes.notes, label: "Notes", icon: FileText },
    { href: routes.tasks, label: "My tasks", icon: CircleCheckBig },
    { href: routes.projects, label: "Projects", icon: FolderKanban },
    { href: routes.databases, label: "Databases", icon: Table2 },
    { href: routes.graph, label: "Graph view", icon: Network },
    { href: routes.calendar, label: "Calendar", icon: CalendarDays },
  ];

  return (
    <div className="flex h-full flex-col" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <WorkspaceSwitcher />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground md:flex"
            >
              <ChevronsLeft className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Collapse sidebar <Kbd className="ml-1">{modKey()} \</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      <nav className="space-y-px px-2 py-1">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Search className="size-4" strokeWidth={1.75} />
          Search
          <Kbd className="ml-auto">{modKey()} K</Kbd>
        </button>
        {nav.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.replace(/\/$/, "") === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <NavLink key={item.href} href={item.href} icon={item.icon} active={active}>
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
        {pages.isPending ? (
          <div className="space-y-1.5 px-1 pt-3">
            {[70, 55, 80, 45, 60].map((w, i) => (
              <Skeleton key={i} className="h-5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <>
            {favorites.length > 0 && (
              <Section title="Favorites">
                <PageTree pages={pages.data!.pages} favoriteIds={pages.data!.favoriteIds} roots={favorites} idPrefix="fav" />
              </Section>
            )}
            {!!recent.data?.length && (
              <Section title="Recently opened" defaultOpen={false}>
                <ul className="space-y-px">
                  {recent.data.slice(0, 5).map((p) => (
                    <li key={p.id}>
                      <Link
                        href={routes.page(p.id)}
                        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sidebar-foreground hover:bg-sidebar-accent"
                      >
                        <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-[15px]" />
                        <span className="truncate">{p.title || "Untitled"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {pinned.length > 0 && (
              <Section title="Pinned">
                <PageTree pages={pages.data!.pages} favoriteIds={pages.data!.favoriteIds} roots={pinned} idPrefix="pin" />
              </Section>
            )}
            <Section
              title="Pages"
              action={
                canEdit && (
                  <SectionAction label="Add a page" onClick={() => create.mutate({})}>
                    <Plus className="size-3.5" />
                  </SectionAction>
                )
              }
            >
              <PageTree pages={pages.data?.pages ?? []} favoriteIds={pages.data?.favoriteIds ?? []} />
              {canEdit && (
                <div className="mt-px space-y-px">
                  <button
                    type="button"
                    onClick={() => create.mutate({})}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <Plus className="size-4" />
                    New page
                  </button>
                  <button
                    type="button"
                    onClick={() => create.mutate({ kind: "DATABASE", title: "Untitled database" })}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <Table2 className="size-4" strokeWidth={1.75} />
                    New database
                  </button>
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      <SpotifySidebarWidget />
      <div className="space-y-px border-t border-sidebar-border px-2 py-2">
        <NavLink href={routes.settings()} icon={Settings} active={pathname.startsWith("/settings")}>
          Settings
        </NavLink>
        <TrashPopover>
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-sidebar-foreground hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent"
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
            Trash
          </button>
        </TrashPopover>
      </div>
    </div>
  );
}

function NavLink({ href, icon: Icon, active, children }: { href: string; icon: LucideIcon; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-sidebar-foreground hover:bg-sidebar-accent",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
      {children}
    </Link>
  );
}

function Section({
  title,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-3 first:mt-1">
      <div className="group/section flex h-6 items-center px-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          {title}
        </button>
        <div className="ml-auto opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
          {action}
        </div>
      </div>
      {open && children}
    </section>
  );
}

function SectionAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** Desktop sidebar with drag-to-resize and collapse. */
export function Sidebar() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const width = useUI((s) => s.sidebarWidth);
  const setWidth = useUI((s) => s.setSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const startRef = useRef<{ x: number; w: number } | null>(null);

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        "relative hidden h-full shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar md:block",
        !resizing && "transition-[width] duration-200 ease-out",
        collapsed && "border-r-0",
      )}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="h-full" style={{ width }}>
        <SidebarContent />
      </div>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setWidth(width - 16);
            if (e.key === "ArrowRight") setWidth(width + 16);
          }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            startRef.current = { x: e.clientX, w: width };
            setResizing(true);
          }}
          onPointerMove={(e) => {
            if (startRef.current) setWidth(startRef.current.w + e.clientX - startRef.current.x);
          }}
          onPointerUp={() => {
            startRef.current = null;
            setResizing(false);
          }}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize transition-colors hover:bg-brand/30 focus-visible:bg-brand/40 focus-visible:outline-none"
        />
      )}
    </aside>
  );
}
