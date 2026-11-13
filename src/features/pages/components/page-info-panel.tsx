"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronRight, CircleCheckBig, Columns2, FileStack, Hash, Link2, ListTree, Plus, Tag, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PageIcon } from "@/components/common";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { listBacklinks, listUnlinkedMentions } from "@/data/repo/pages";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import type { JSONNode } from "@/features/editor/doc";
import { useUpdatePage, type PageDetail } from "../hooks";
import { useTasks } from "@/features/projects/hooks";
import { StatusIcon } from "@/features/projects/components/task-fields";

export type OutlineItem = { level: number; text: string; index: number };

export function outlineOf(doc: unknown): OutlineItem[] {
  const out: OutlineItem[] = [];
  let index = 0;
  for (const node of ((doc as JSONNode)?.content ?? []) as JSONNode[]) {
    if (node.type === "heading") {
      const text = (node.content ?? []).map((c) => c.text ?? c.attrs?.label ?? "").join("").trim();
      if (text) out.push({ level: Number(node.attrs?.level ?? 1), text, index });
      index += 1;
    }
  }
  return out;
}

/** Right-hand panel: outline, backlinks, mentions, tags and properties. */
export function PageInfoPanel({
  page,
  doc,
  onClose,
  onJump,
  onOpenSplit,
}: {
  page: PageDetail;
  doc: unknown;
  onClose: () => void;
  onJump: (headingIndex: number) => void;
  onOpenSplit: (pageId: string) => void;
}) {
  const { store, workspaceId } = useWorkspaceCtx();
  const update = useUpdatePage(workspaceId, page.id);
  const backlinks = useQuery({ queryKey: ["backlinks", workspaceId, page.id], queryFn: () => listBacklinks(store, page.id) });
  const mentions = useQuery({ queryKey: ["mentions", workspaceId, page.id, page.title], queryFn: () => listUnlinkedMentions(store, page.id) });
  const tasks = useTasks(workspaceId, { pageId: page.id, includeSubtasks: true });
  const outline = outlineOf(doc);
  const [tag, setTag] = useState("");
  const [propKey, setPropKey] = useState("");
  const editable = page.canEdit;

  const addTag = () => {
    const t = tag.trim().replace(/^#/, "").toLowerCase();
    if (t && !page.tags.includes(t)) update.mutate({ tags: [...page.tags, t] });
    setTag("");
  };

  return (
    <aside aria-label="Page details" className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-sidebar/50 scrollbar-thin">
      <div className="flex h-11 items-center justify-between border-b px-3">
        <span className="text-sm font-medium">Details</span>
        <button type="button" aria-label="Close details" onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
          <X className="size-4" />
        </button>
      </div>

      <Section icon={<ListTree />} title="Outline" count={outline.length}>
        {outline.length === 0 ? (
          <Empty>Headings in this page appear here.</Empty>
        ) : (
          <ul>
            {outline.map((h) => (
              <li key={h.index}>
                <button
                  type="button"
                  onClick={() => onJump(h.index)}
                  className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Link2 />} title="Backlinks" count={backlinks.data?.length}>
        {!backlinks.data?.length ? (
          <Empty>No pages link here yet. Type [[ in another page to link to this one.</Empty>
        ) : (
          <RefList items={backlinks.data} onOpenSplit={onOpenSplit} />
        )}
      </Section>

      <Section icon={<CircleCheckBig />} title="Tasks" count={tasks.data?.length}>
        {!tasks.data?.length ? (
          <Empty>Link a task to this note from the task&apos;s “Note” field.</Empty>
        ) : (
          <ul>
            {tasks.data.map((t) => (
              <li key={t.id}>
                <Link href={routes.task(t.id)} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                  <StatusIcon status={t.status} />
                  <span className={cn("truncate", t.status === "COMPLETED" && "text-muted-foreground line-through")}>{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Hash />} title="Unlinked mentions" count={mentions.data?.length} defaultOpen={false}>
        {!mentions.data?.length ? <Empty>No other page mentions “{page.title || "Untitled"}”.</Empty> : <RefList items={mentions.data} onOpenSplit={onOpenSplit} />}
      </Section>

      <Section icon={<Tag />} title="Tags & properties">
        <div className="flex flex-wrap gap-1 px-2">
          {page.tags.map((t) => (
            <span key={t} className="inline-flex h-6 items-center gap-1 rounded-full border bg-background px-2 text-xs">
              #{t}
              {editable && (
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => update.mutate({ tags: page.tags.filter((x) => x !== t) })}>
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {editable && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addTag();
              }}
            >
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onBlur={addTag}
                placeholder="+ tag"
                aria-label="Add tag"
                className="h-6 w-20 rounded-full bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              />
            </form>
          )}
        </div>
        <p className="mt-1 px-2 text-[11px] text-muted-foreground">#tags written in the page also count.</p>
        <dl className="mt-3 space-y-1 px-2">
          {Object.entries(page.properties)
            .filter(([k]) => k !== "skele")
            .map(([k, v]) => (
              <div key={k} className="grid grid-cols-[90px_1fr_auto] items-center gap-1.5 text-sm">
                <dt className="truncate text-muted-foreground">{k}</dt>
                <dd>
                  <input
                    defaultValue={v}
                    readOnly={!editable}
                    aria-label={k}
                    onBlur={(e) => e.target.value !== v && update.mutate({ properties: { ...page.properties, [k]: e.target.value.slice(0, 500) } })}
                    className="h-7 w-full rounded bg-transparent px-1.5 outline-none hover:bg-accent focus:bg-background focus:ring-1 focus:ring-ring"
                  />
                </dd>
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remove ${k}`}
                    onClick={() => {
                      const next = { ...page.properties };
                      delete next[k];
                      update.mutate({ properties: next });
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
        </dl>
        {editable && (
          <form
            className="mt-2 flex items-center gap-1 px-2"
            onSubmit={(e) => {
              e.preventDefault();
              const k = propKey.trim().slice(0, 40);
              if (k && !(k in page.properties)) update.mutate({ properties: { ...page.properties, [k]: "" } });
              setPropKey("");
            }}
          >
            <Plus className="size-3.5 text-muted-foreground" />
            <input
              value={propKey}
              onChange={(e) => setPropKey(e.target.value)}
              placeholder="Add a property"
              aria-label="New property name"
              className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </form>
        )}
        {editable && (
          <label className="mt-3 flex items-center justify-between gap-2 border-t px-2 pt-3 text-sm">
            <span className="flex items-center gap-1.5">
              <FileStack className="size-4 text-muted-foreground" /> Use as template
            </span>
            <Switch checked={page.isTemplate} onCheckedChange={(v) => update.mutate({ isTemplate: v })} aria-label="Use as template" />
          </label>
        )}
      </Section>
    </aside>
  );
}

function RefList({ items, onOpenSplit }: { items: { id: string; title: string; icon: string | null; kind: "DOCUMENT" | "DATABASE"; snippet: string }[]; onOpenSplit: (id: string) => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((p) => (
        <li key={p.id} className="group relative rounded-md hover:bg-accent">
          <Link href={routes.page(p.id)} className="block px-2 py-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <PageIcon icon={p.icon} kind={p.kind} className="size-3.5 text-[13px]" />
              <span className="truncate">{p.title || "Untitled"}</span>
            </span>
            {p.snippet && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.snippet}</span>}
          </Link>
          <button
            type="button"
            title="Open side by side"
            aria-label={`Open ${p.title} side by side`}
            onClick={() => onOpenSplit(p.id)}
            className="absolute top-1.5 right-1.5 hidden size-6 items-center justify-center rounded text-muted-foreground group-hover:flex hover:bg-background"
          >
            <Columns2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Section({ icon, title, count, children, defaultOpen = true }: { icon: ReactNode; title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b px-1 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
      >
        <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
        {icon}
        {title}
        {count !== undefined && count > 0 && <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px]">{count}</span>}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>;
}
