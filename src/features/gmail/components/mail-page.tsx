"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Loader2, Mail, Paperclip, PenSquare, RefreshCw, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { errorText } from "@/lib/oauth";
import { markdownToDoc } from "@/features/import-export/markdown";
import { useCreatePage } from "@/features/pages/hooks";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { FOLDERS, parseAddress, type Folder, type Mail as MailMessage } from "../api";
import { useGmailProfile, useGmailStatus, useMailList } from "../hooks";
import { formatDate, mailToPage } from "../text";
import { ComposeDialog, type ComposeInit } from "./compose-dialog";
import { MailView } from "./mail-view";

export function MailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const status = useGmailStatus();
  const connected = !!status.data?.connected;
  const me = useGmailProfile(connected);
  const folder = (FOLDERS.find((f) => f.id === params.get("folder"))?.id ?? "inbox") as Folder;
  const query = params.get("q") ?? "";
  const selected = params.get("m");
  const [draft, setDraft] = useState(query);
  // The search box follows the URL (back/forward, Clear).
  const [shownQuery, setShownQuery] = useState(query);
  if (shownQuery !== query) {
    setShownQuery(query);
    setDraft(query);
  }
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const list = useMailList(folder, query, connected);
  const createPage = useCreatePage(workspaceId);

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const s = p.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // "Compose email" from the command palette opens /mail?compose=1.
  const composing = compose ?? (params.get("compose") ? {} : null);
  const closeCompose = () => {
    setCompose(null);
    if (params.get("compose")) setParams({ compose: null });
  };

  const saveAsPage = (m: MailMessage) => {
    const { title, markdown } = mailToPage(m, me.data?.emailAddress);
    createPage.mutate(
      { title, doc: markdownToDoc(markdown).doc, navigate: false },
      { onSuccess: (page) => toast.success("Saved as a page", { action: { label: "Open", onClick: () => router.push(routes.page(page.id)) } }) },
    );
  };

  const header = <Topbar crumbs={[{ label: "Mail" }]} actions={connected ? <ComposeButton onClick={() => setCompose({})} /> : undefined} />;

  if (!status.data) {
    return (
      <>
        {header}
        <Skeleton className="m-6 h-64" />
      </>
    );
  }

  if (!connected) {
    return (
      <>
        {header}
        <EmptyState
          icon={Mail}
          className="flex-1"
          title="Connect Gmail to read and send mail here"
          description={status.data.ended ?? "Read your inbox, reply, save emails as pages and let the AI look things up in your mail. Set it up in Settings → Integrations."}
          action={
            <Button asChild>
              <Link href={routes.settings("integrations")}>Set up Gmail</Link>
            </Button>
          }
        />
      </>
    );
  }

  const messages = list.data?.pages.flatMap((p) => p.messages) ?? [];

  return (
    <>
      {header}
      <div className="flex min-h-0 flex-1 border-t">
        <section className={cn("flex min-h-0 w-full flex-col border-r md:w-[min(26rem,42%)] md:shrink-0", selected && "hidden md:flex")}>
          <form
            className="flex shrink-0 items-center gap-1 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              setParams({ q: draft.trim() || null, m: null });
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search mail"
                aria-label="Search mail"
                className="h-8 pl-8"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) setParams({ q: null });
                }}
              />
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Refresh" onClick={() => list.refetch()} disabled={list.isFetching}>
              <RefreshCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
          </form>
          {query ? (
            <div className="flex shrink-0 items-center gap-2 px-3 pb-2 text-xs text-muted-foreground">
              Results for “{query}” in all mail
              <button type="button" className="ml-auto underline" onClick={() => setParams({ q: null })}>
                Clear
              </button>
            </div>
          ) : (
            <div role="tablist" aria-label="Folders" className="flex shrink-0 gap-1 px-2 pb-2">
              {FOLDERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={folder === f.id}
                  onClick={() => setParams({ folder: f.id === "inbox" ? null : f.id, m: null })}
                  className={cn("h-7 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent", folder === f.id && "bg-accent font-medium text-foreground")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto border-t scrollbar-thin">
            {list.isPending ? (
              <div className="space-y-3 p-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : list.error ? (
              <p className="p-4 text-sm text-muted-foreground">{errorText(list.error, "Couldn't load your mail.")}</p>
            ) : !messages.length ? (
              <EmptyState icon={Mail} title={query ? "No emails match" : "Nothing here"} />
            ) : (
              <ul>
                {messages.map((m) => {
                  const who = folder === "sent" ? `To ${parseAddress(m.to.split(",")[0] ?? "").name}` : parseAddress(m.from).name;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setParams({ m: m.id })}
                        aria-current={selected === m.id ? "true" : undefined}
                        className={cn("block w-full border-b px-3 py-2 text-left hover:bg-accent/60", selected === m.id && "bg-accent")}
                      >
                        <span className="flex items-center gap-2 text-sm">
                          {m.unread && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                          <span className={cn("min-w-0 flex-1 truncate", m.unread && "font-semibold")}>{who || "(unknown)"}</span>
                          {m.starred && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
                          {m.hasAttachment && <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-label="Has attachments" />}
                          <span className="shrink-0 text-xs text-muted-foreground">{formatDate(m.date)}</span>
                        </span>
                        <span className={cn("block truncate text-sm", m.unread ? "font-medium" : "text-foreground/90")}>{m.subject || "(no subject)"}</span>
                        <span className="block truncate text-xs text-muted-foreground">{m.snippet}</span>
                      </button>
                    </li>
                  );
                })}
                {list.hasNextPage && (
                  <li className="p-2">
                    <Button variant="ghost" className="w-full" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                      {list.isFetchingNextPage && <Loader2 className="animate-spin" />} Load more
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>
        <section className={cn("min-h-0 min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
          {selected ? (
            <MailView
              id={selected}
              account={me.data?.emailAddress}
              onBack={() => setParams({ m: null })}
              onCompose={setCompose}
              onSave={canEdit ? saveAsPage : () => toast.error("You can't add pages to this workspace.")}
              saving={createPage.isPending}
            />
          ) : (
            <EmptyState icon={Mail} className="flex-1" title="Select an email to read it" description={me.data ? `Signed in as ${me.data.emailAddress}` : undefined} />
          )}
        </section>
      </div>
      {composing && <ComposeDialog init={composing} from={me.data?.emailAddress} onClose={closeCompose} />}
    </>
  );
}

function ComposeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick}>
      <PenSquare /> Compose
    </Button>
  );
}
