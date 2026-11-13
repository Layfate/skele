"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CloudOff, FileCode2, FileQuestion, Loader2, MoreHorizontal, PanelRight, RotateCcw, Star, Trash2, X } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/common";
import { isNotFound } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { getPage, recordVisit, saveContent } from "@/data/repo/pages";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useAutosave, type SaveStatus } from "@/features/editor/use-autosave";
import { useUploader } from "@/features/files/hooks";
import type { JSONNode } from "@/features/editor/doc";
import { pageKeys, usePage, usePages, usePurgePage, useRestorePage, useToggleFavorite, useUpdatePage, type PageDetail } from "../hooks";
import { useEditorHost } from "../use-editor-host";
import { PageHeader } from "./page-header";
import { PageActionsMenu } from "./page-actions-menu";
import { PageInfoPanel } from "./page-info-panel";
import { MarkdownSource } from "./markdown-source";

const SkeleEditor = dynamic(() => import("@/features/editor/editor").then((m) => m.SkeleEditor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

const DatabaseView = dynamic(() => import("@/features/databases/components/database-view").then((m) => m.DatabaseView), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

const PANEL_KEY = "skele-info-panel";

export function PageView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pageId = params.get("id") ?? "";
  const splitId = params.get("split");
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const togglePanel = () =>
    setPanelOpen((v) => {
      try {
        localStorage.setItem(PANEL_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });

  const setSplit = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id && id !== pageId) next.set("split", id);
    else next.delete("split");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageLoader key={pageId} pageId={pageId} panelOpen={panelOpen} onTogglePanel={togglePanel} onOpenSplit={setSplit} />
      </div>
      {splitId && splitId !== pageId && (
        <div className="hidden min-w-0 flex-1 flex-col border-l lg:flex">
          <PageLoader key={`split-${splitId}`} pageId={splitId} compact onClose={() => setSplit(null)} onOpenSplit={setSplit} />
        </div>
      )}
    </div>
  );
}

type LoaderProps = {
  pageId: string;
  compact?: boolean;
  onClose?: () => void;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  onOpenSplit: (id: string | null) => void;
};

function PageLoader({ pageId, compact, ...rest }: LoaderProps) {
  const { workspaceId, store } = useWorkspaceCtx();
  const page = usePage(workspaceId, pageId);

  useEffect(() => {
    if (pageId && !compact) recordVisit(store, pageId).catch(() => {});
  }, [store, pageId, compact]);

  if (page.error || !pageId) {
    const missing = !pageId || isNotFound(page.error);
    return (
      <>
        {!compact && <Topbar crumbs={[{ label: "Not found" }]} />}
        <EmptyState
          icon={FileQuestion}
          title={missing ? "This page doesn't exist" : "Could not load this page"}
          description={missing ? "It may have been deleted, or it belongs to another workspace." : page.error?.message}
          action={
            <Button asChild variant="outline">
              <Link href={routes.home}>Back to home</Link>
            </Button>
          }
          className="flex-1"
        />
      </>
    );
  }
  if (!page.data) {
    return (
      <>
        {!compact && <Topbar crumbs={[{ label: "" }]} />}
        <div className="mx-auto w-full max-w-[760px] px-6 pt-20">
          <Skeleton className="mb-6 h-11 w-2/3" />
          <EditorSkeleton />
        </div>
      </>
    );
  }
  return <LoadedPage page={page.data} compact={compact} {...rest} />;
}

function LoadedPage({ page, compact, onClose, panelOpen = false, onTogglePanel, onOpenSplit }: Omit<LoaderProps, "pageId"> & { page: PageDetail }) {
  const { workspaceId, store, canPurge } = useWorkspaceCtx();
  const qc = useQueryClient();
  const router = useRouter();
  const pages = usePages(workspaceId);
  const update = useUpdatePage(workspaceId, page.id);
  const favorite = useToggleFavorite(workspaceId);
  const restore = useRestorePage(workspaceId);
  const purge = usePurgePage(workspaceId);
  const upload = useUploader(workspaceId, page.id);
  const host = useEditorHost(workspaceId);
  const editorRef = useRef<Editor | null>(null);
  const [docKey, setDocKey] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [liveDoc, setLiveDoc] = useState<unknown>(page.content.doc);
  const archived = !!page.archivedAt;
  const editable = page.canEdit;
  const pageId = page.id;

  const autosave = useAutosave({
    save: (doc, version) => saveContent(store, pageId, { doc, version }),
    initialVersion: page.content.version,
    onConflict: () => {
      toast.info("This page was changed in another window — loaded the latest version.");
      void reload();
    },
    onSaved: (version) => {
      qc.setQueryData<PageDetail>(pageKeys.one(workspaceId, pageId), (p) => (p ? { ...p, content: { ...p.content, version } } : p));
      qc.invalidateQueries({ queryKey: ["backlinks", workspaceId] });
      qc.invalidateQueries({ queryKey: pageKeys.edited(workspaceId) });
    },
  });
  const { schedule, flush, reset } = autosave;

  async function reload() {
    const fresh = await qc.fetchQuery({ queryKey: pageKeys.one(workspaceId, pageId), queryFn: () => getPage(store, pageId), staleTime: 0 });
    reset(fresh.content.version);
    setLiveDoc(fresh.content.doc);
    setDocKey((k) => k + 1);
  }

  // Keep the cached doc in sync so navigating away and back shows the latest content.
  const onUpdate = useCallback(
    (doc: object) => {
      schedule(doc);
      setLiveDoc(doc);
      qc.setQueryData<PageDetail>(pageKeys.one(workspaceId, pageId), (p) => (p ? { ...p, content: { ...p.content, doc } } : p));
    },
    [schedule, qc, workspaceId, pageId],
  );

  const onEditor = useCallback((e: Editor | null) => {
    editorRef.current = e;
  }, []);

  const applySource = async (doc: JSONNode) => {
    await flush();
    try {
      const cached = qc.getQueryData<PageDetail>(pageKeys.one(workspaceId, pageId));
      await saveContent(store, pageId, { doc, version: cached?.content.version ?? page.content.version });
      await reload();
      setSourceMode(false);
      toast.success("Markdown applied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply the changes");
    }
  };

  const jumpToHeading = (index: number) => {
    editorRef.current?.view.dom.querySelectorAll("h1, h2, h3")[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const crumbs = page.breadcrumbs.map((c) => ({
    label: c.title || "Untitled",
    icon: c.icon,
    href: routes.page(c.id),
    kind: c.id === page.id ? page.kind : undefined,
  }));

  const actions = (
    <>
      {!archived && editable && page.kind === "DOCUMENT" && <SaveIndicator status={autosave.status} />}
      {page.kind === "DOCUMENT" && (
        <IconAction
          label={sourceMode ? "Back to editor" : "Edit as Markdown"}
          pressed={sourceMode}
          onClick={async () => {
            await flush();
            setSourceMode((v) => !v);
          }}
        >
          <FileCode2 />
        </IconAction>
      )}
      <IconAction
        label={page.isFavorite ? "Remove from favorites" : "Add to favorites"}
        pressed={page.isFavorite}
        onClick={() => favorite.mutate({ id: page.id, favorite: !page.isFavorite })}
      >
        <Star className={cn(page.isFavorite && "fill-amber-400 text-amber-400")} />
      </IconAction>
      {!compact && onTogglePanel && (
        <IconAction label={panelOpen ? "Hide details" : "Details: outline, backlinks, tags"} pressed={panelOpen} onClick={onTogglePanel}>
          <PanelRight />
        </IconAction>
      )}
      {!archived && (
        <PageActionsMenu
          page={{ id: page.id, pinned: page.pinned, isFavorite: page.isFavorite, fullWidth: page.fullWidth }}
          align="end"
        >
          <Button variant="ghost" size="icon-sm" aria-label="Page actions">
            <MoreHorizontal />
          </Button>
        </PageActionsMenu>
      )}
      {compact && onClose && (
        <IconAction label="Close side page" onClick={onClose}>
          <X />
        </IconAction>
      )}
    </>
  );

  return (
    <>
      {compact ? (
        <div className="flex h-11 shrink-0 items-center gap-1 px-3">
          <Link href={routes.page(page.id)} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
            {page.icon} {page.title || "Untitled"}
          </Link>
          {actions}
        </div>
      ) : (
        <Topbar crumbs={crumbs} actions={actions} />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
          {archived && (
            <div className="flex flex-wrap items-center justify-center gap-3 bg-destructive/90 px-4 py-2 text-sm text-white">
              <span>This page is in the trash.</span>
              <Button size="xs" variant="secondary" onClick={() => restore.mutate(page.id)}>
                <RotateCcw /> Restore
              </Button>
              {canPurge && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    if (confirm("Delete this page permanently? This cannot be undone.")) {
                      purge.mutate(page.id, { onSuccess: () => router.replace(routes.home) });
                    }
                  }}
                >
                  <Trash2 /> Delete permanently
                </Button>
              )}
            </div>
          )}
          <div
            className="mx-auto w-full px-[var(--page-gutter)] [--page-gutter:clamp(1.25rem,5vw,4.5rem)]"
            style={{ maxWidth: page.fullWidth || page.kind === "DATABASE" ? "none" : "calc(46rem + 2 * var(--page-gutter))" }}
          >
            <PageHeader
              page={page}
              editable={editable}
              onChange={(input) => update.mutate(input)}
              onEnter={() => {
                const editor = editorRef.current;
                if (!editor) return;
                // Move DOM focus synchronously; Tiptap's focus() applies on the next frame.
                editor.view.dom.focus();
                editor.commands.focus("start");
              }}
              upload={upload}
            />
            {page.kind === "DATABASE" ? (
              <DatabaseView pageId={page.id} editable={editable} />
            ) : sourceMode ? (
              <MarkdownSource doc={liveDoc} pages={pages.data?.pages ?? []} editable={editable} onApply={applySource} onCancel={() => setSourceMode(false)} />
            ) : (
              <SkeleEditor
                docKey={`${page.id}:${docKey}`}
                initialContent={qc.getQueryData<PageDetail>(pageKeys.one(workspaceId, pageId))?.content.doc ?? page.content.doc}
                editable={editable}
                onUpdate={onUpdate}
                upload={upload}
                host={host}
                onEditor={onEditor}
              />
            )}
          </div>
        </div>
        {panelOpen && !compact && (
          <div className="hidden xl:flex">
            <PageInfoPanel page={page} doc={liveDoc} onClose={() => onTogglePanel?.()} onJump={jumpToHeading} onOpenSplit={(id) => onOpenSplit(id)} />
          </div>
        )}
      </div>
    </>
  );
}

function IconAction({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} onClick={onClick} className={cn(pressed && "bg-accent")}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; icon: React.ReactNode }> = {
    saved: { label: "Saved", icon: <Check className="size-3.5" /> },
    saving: { label: "Saving…", icon: <Loader2 className="size-3.5 animate-spin" /> },
    unsaved: { label: "Editing", icon: <span className="size-1.5 rounded-full bg-muted-foreground" /> },
    error: { label: "Couldn't save — retrying", icon: <CloudOff className="size-3.5" /> },
  };
  const s = map[status];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex", status === "error" && "text-destructive")}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-hidden>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
