"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { ChevronsRight, Menu } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd, PageIcon, modKey } from "@/components/common";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";

export type Crumb = { label: string; href?: string; icon?: string | null; kind?: "DOCUMENT" | "DATABASE" };

/** Minimal top bar: sidebar toggle (when hidden), breadcrumbs, and contextual actions. */
export function Topbar({ crumbs, actions, className }: { crumbs: Crumb[]; actions?: ReactNode; className?: string }) {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const toggle = useUI((s) => s.toggleSidebar);
  const openMobile = useUI((s) => s.setMobileSidebarOpen);

  // Long paths collapse the middle into an ellipsis.
  const shown: (Crumb | "…")[] = crumbs.length > 4 ? [crumbs[0], "…", ...crumbs.slice(-2)] : crumbs;

  return (
    <header className={cn("flex h-11 shrink-0 items-center gap-1 px-3", className)}>
      <button
        type="button"
        aria-label="Open sidebar"
        onClick={() => openMobile(true)}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
      >
        <Menu className="size-4" />
      </button>
      {collapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Expand sidebar"
              onClick={toggle}
              className="hidden size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:flex"
            >
              <ChevronsRight className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Expand sidebar <Kbd className="ml-1">{modKey()} \</Kbd>
          </TooltipContent>
        </Tooltip>
      )}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center">
        <ol className="flex min-w-0 items-center gap-0.5 text-sm">
          {shown.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <li aria-hidden className="px-0.5 text-muted-foreground/60">/</li>}
              <li className="min-w-0">
                {c === "…" ? (
                  <span className="px-1 text-muted-foreground">…</span>
                ) : c.href && i < shown.length - 1 ? (
                  <Link
                    href={c.href}
                    className="flex max-w-48 items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {(c.icon || c.kind) && <PageIcon icon={c.icon} kind={c.kind} className="size-3.5 text-[13px]" />}
                    <span className="truncate">{c.label}</span>
                  </Link>
                ) : (
                  <span aria-current="page" className="flex max-w-72 items-center gap-1.5 truncate px-1.5 py-0.5">
                    {(c.icon || c.kind) && <PageIcon icon={c.icon} kind={c.kind} className="size-3.5 text-[13px]" />}
                    <span className="truncate">{c.label}</span>
                  </span>
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </header>
  );
}
