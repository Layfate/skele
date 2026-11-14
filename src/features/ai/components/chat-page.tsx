"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isToday, isYesterday, subDays } from "date-fns";
import { toast } from "sonner";
import {
  ArrowDown,
  BookOpenText,
  Lightbulb,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  PanelLeft,
  PenLine,
  Pin,
  PinOff,
  Search,
  Settings2,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd } from "@/components/common";
import { formatCombo, resolvedShortcuts } from "@/features/shell/shortcuts";
import { usePreferences } from "@/features/settings/hooks";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { isDesktop } from "@/lib/desktop";
import { markdownToDoc } from "@/features/import-export/markdown";
import { useCreatePage } from "@/features/pages/hooks";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import {
  useAgents,
  useAiSettings,
  useChat,
  useChatActions,
  useChats,
  useCreateChat,
  useDeleteChat,
  useLimit,
  useMcpServers,
  useRuns,
  useSkills,
  useUpdateAiSettings,
  useUpdateChat,
  type LiveRun,
} from "../hooks";
import { defaultProvider, providerAvailable } from "../run";
import { parseCommand } from "../commands";
import { chatTokens, contextBudget } from "../context";
import { DEFAULT_MODEL, isCli, PROVIDERS, type AiSettings, type ChatSummary, type Effort, type ProviderId } from "../types";
import { AccessMenu, AgentMenu, type Access } from "./chat-controls";
import { Composer, type ComposerHandle } from "./composer";
import { AssistantMessage, UserMessage } from "./messages";
import { EffortMenu, ProviderIcon, ProviderMenu } from "./provider-menu";

export function ChatPage() {
  const { workspaceId } = useWorkspaceCtx();
  const params = useSearchParams();
  const chatId = params.get("id");
  const chat = useChat(chatId);
  const settings = useAiSettings();
  const [listOpen, setListOpen] = useState(false);

  return (
    <>
      <Topbar
        crumbs={[{ label: "Chat", href: routes.chat() }, ...(chat.data ? [{ label: chat.data.title }] : [])]}
        actions={
          <>
            <button
              type="button"
              onClick={() => setListOpen(true)}
              aria-label="Show chats"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent lg:hidden"
            >
              <PanelLeft className="size-4" />
            </button>
            <Link
              href={routes.settings("ai")}
              aria-label="AI settings"
              title="AI settings"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings2 className="size-4" />
            </Link>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r lg:flex">
          <ChatList workspaceId={workspaceId} activeId={chatId} />
        </aside>
        <Sheet open={listOpen} onOpenChange={setListOpen}>
          <SheetContent side="left" className="p-0 data-[side=left]:w-[290px]">
            <SheetTitle className="sr-only">Chats</SheetTitle>
            <ChatList workspaceId={workspaceId} activeId={chatId} onNavigate={() => setListOpen(false)} />
          </SheetContent>
        </Sheet>
        <section className="flex min-w-0 flex-1 flex-col">
          {!settings.data || (chatId && chat.isPending) ? (
            <div className="mx-auto w-full max-w-3xl space-y-4 p-8">
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : chatId && chat.isError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              This chat was deleted.
              <Button variant="outline" asChild>
                <Link href={routes.chat()}>Start a new chat</Link>
              </Button>
            </div>
          ) : (
            <Conversation key={chatId ?? "new"} chatId={chatId} settings={settings.data} />
          )}
        </section>
      </div>
    </>
  );
}

const SUGGESTIONS = [
  { icon: BookOpenText, label: "Summarize a page", prompt: "", pages: true },
  { icon: PenLine, label: "Draft a note", prompt: "Draft a clear, well-structured note about " },
  { icon: Lightbulb, label: "Brainstorm ideas", prompt: "Brainstorm 10 ideas for " },
  { icon: Wand2, label: "Improve my writing", prompt: "Rewrite this to be clearer and more concise:\n\n" },
];

const NO_RUNS: LiveRun[] = [];

function Conversation({ chatId, settings }: { chatId: string | null; settings: AiSettings }) {
  const { workspaceId, workspace } = useWorkspaceCtx();
  const router = useRouter();
  const chat = useChat(chatId);
  const liveRuns = useRuns((s) => (chatId ? s.runs[chatId] : undefined)) ?? NO_RUNS;
  const live = liveRuns.length ? liveRuns : undefined;
  const servers = useMcpServers();
  const agents = useAgents();
  const desktop = isDesktop();
  const actions = useChatActions(workspaceId, workspace.name);
  const createChat = useCreateChat(workspaceId);
  const updateChat = useUpdateChat();
  const updateSettings = useUpdateAiSettings();
  const createPage = useCreatePage(workspaceId);
  const composer = useRef<ComposerHandle>(null);

  // Provider/model for a chat that doesn't exist yet (created on the first message).
  const fallback = defaultProvider(settings);
  type Draft = { provider: ProviderId; model: string; effort: Effort; access?: Access; agentId?: string };
  const [draft, setDraftState] = useState<Partial<Draft>>({});
  const setDraft = (d: Partial<Draft>) => setDraftState((prev) => ({ ...prev, ...d }));
  const provider = chat.data?.provider ?? draft.provider ?? fallback;
  const defaultModel = (p: ProviderId | null) =>
    p === "openai" ? settings.openaiModel : p === "ollama" ? settings.ollamaModel : p ? DEFAULT_MODEL[p] : "";
  const model = chat.data?.model ?? draft.model ?? defaultModel(provider);
  const effort = chat.data?.effort ?? draft.effort ?? "medium";
  const autoServers = (servers.data ?? []).filter((s) => s.enabled && s.autoAttach).map((s) => s.id);
  const access: Access = chat.data
    ? { mode: chat.data.mode ?? "chat", folder: chat.data.folder, web: !!chat.data.web, mcp: chat.data.mcp ?? [] }
    : (draft.access ?? { mode: "chat", web: false, mcp: autoServers });
  const agentId = chat.data ? chat.data.agentId : draft.agentId;
  const messages = chat.data?.messages ?? [];
  const running = !!live;
  const usable = !!provider && providerAvailable(provider, settings);
  const cli = !!provider && isCli(provider) && desktop;
  const skills = useSkills(cli);

  const choose = (p: ProviderId, m: string) => {
    if (p === "openai") updateSettings.mutate({ openaiModel: m });
    if (p === "ollama" && m) updateSettings.mutate({ ollamaModel: m });
    updateSettings.mutate({ defaultProvider: p });
    if (chat.data) updateChat.mutate({ id: chat.data.id, patch: { provider: p, model: m } });
    else setDraft({ provider: p, model: m });
  };
  const chooseEffort = (e: Effort) => {
    if (chat.data) updateChat.mutate({ id: chat.data.id, patch: { effort: e } });
    else setDraft({ effort: e });
  };
  const changeAccess = (p: Partial<Access>) => {
    if (chat.data) updateChat.mutate({ id: chat.data.id, patch: p });
    else setDraft({ access: { ...access, ...p } });
  };
  const chooseAgent = (id: string | undefined) => {
    if (chat.data) updateChat.mutate({ id: chat.data.id, patch: { agentId: id } });
    else setDraft({ agentId: id });
  };

  const send = async (text: string, pages: { id: string; title: string; icon?: string | null }[]) => {
    if (!provider) return;
    // /usage, /status, /model … are answered by Skele; /new starts a fresh chat.
    const command = pages.length ? null : parseCommand(text);
    if (command?.name === "new") {
      router.push(routes.chat());
      return;
    }
    const run = (id: string) => (command ? actions.command(id, command.name, command.args) : actions.send(id, text, pages));
    if (chat.data) return run(chat.data.id);
    const created = await createChat.mutateAsync({ provider, model, effort, ...access, agentId });
    router.replace(routes.chat(created.id), { scroll: false });
    await run(created.id);
  };

  const saveAsPage = (text: string) => {
    const title = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? chat.data?.title ?? "From chat";
    createPage.mutate(
      { title: title.slice(0, 120), doc: markdownToDoc(text).doc, navigate: false },
      {
        onSuccess: (page) =>
          toast.success("Saved as a page", { action: { label: "Open", onClick: () => router.push(routes.page(page.id)) } }),
      },
    );
  };

  // Follow the reply while it streams, unless the user scrolled up to read.
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);
  const liveSize = liveRuns.reduce((n, r) => n + r.text.length + r.thinking.length + r.activity.length + (r.status ? 1 : 0), 0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveSize]);
  useEffect(() => {
    composer.current?.focus();
  }, []);

  const toolbar = provider && usable && (
    <>
      <ProviderMenu settings={settings} provider={provider} model={model} onChange={choose} />
      <EffortMenu effort={effort} onChange={chooseEffort} />
      {cli && <AccessMenu provider={provider} value={access} servers={servers.data ?? []} cliExtensions={settings.useCliExtensions} onChange={changeAccess} />}
      {(agents.data?.length ?? 0) > 0 && <AgentMenu agents={agents.data!} agentId={agentId} onChange={chooseAgent} />}
    </>
  );
  const status = provider && usable && (
    <>
      <LimitChip provider={provider} settings={settings} />
      {chat.data && !isCli(provider) && <ContextMeter tokens={chatTokens(chat.data)} budget={contextBudget(provider, settings)} />}
    </>
  );

  if (!usable) return <SetupNeeded />;

  const composerEl = (
    <Composer
      ref={composer}
      workspaceId={workspaceId}
      running={running}
      onSend={send}
      onStop={() => chatId && actions.stop(chatId)}
      toolbar={toolbar}
      status={status}
      skills={cli ? skills.data : undefined}
      agents={agents.data}
      placeholder={messages.length ? "Reply…" : "Ask anything, or attach a page…"}
    />
  );

  if (messages.length === 0 && !live) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[12vh]">
        <div className="w-full max-w-2xl">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <ProviderIcon provider={provider!} className="size-11 rounded-xl [&_svg]:size-5" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting()}
            </h1>
            <p className="text-muted-foreground">Ask a question, draft something new, or attach pages to talk about your notes.</p>
          </div>
          {composerEl}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => (s.pages ? composer.current?.openPages() : composer.current?.setText(s.prompt))}
                className="flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-sm text-muted-foreground transition hover:border-brand/40 hover:text-foreground"
              >
                <s.icon className="size-3.5" strokeWidth={1.75} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  return (
    <>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          stick.current = bottom;
          if (bottom !== atBottom) setAtBottom(bottom);
        }}
        className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin"
      >
        <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-8 sm:px-6">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage
                key={m.id}
                message={m}
                editable={!running}
                onEdit={(text) => chat.data && actions.edit(chat.data.id, m.id, text)}
              />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                showThinking={settings.showThinking}
                isLast={i === lastAssistant && i === messages.length - 1 && !running}
                onRegenerate={() => chat.data && actions.regenerate(chat.data.id)}
                onSaveAsPage={saveAsPage}
              />
            ),
          )}
          {live?.map((l) => <AssistantMessage key={l.key} live={l} showThinking={settings.showThinking} />)}
          {!live && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => chat.data && actions.regenerate(chat.data.id)}>
                Get a reply
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
        {!atBottom && (
          <button
            type="button"
            aria-label="Scroll to the latest message"
            onClick={() => {
              stick.current = true;
              setAtBottom(true);
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            }}
            className="absolute -top-11 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-foreground"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
        {composerEl}
        <p className="mt-2 text-center text-xs text-muted-foreground/80">AI can make mistakes. Check important information.</p>
      </div>
    </>
  );
}

const shortTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** How full the model's context window is getting (shown once it's worth knowing). */
function ContextMeter({ tokens, budget }: { tokens: number; budget: number }) {
  const ratio = tokens / budget;
  if (ratio < 0.4) return null;
  return (
    <span
      title={`About ${tokens.toLocaleString()} of ${budget.toLocaleString()} tokens. Type /compact to summarize older messages.`}
      className={cn("hidden items-center gap-1 text-xs tabular-nums sm:flex", ratio >= 0.85 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/80")}
    >
      <span className="relative size-3 rounded-full border border-current">
        <span className="absolute inset-0.5 origin-left rounded-full bg-current" style={{ transform: `scaleX(${Math.min(1, ratio)})` }} />
      </span>
      {shortTokens(tokens)}
    </span>
  );
}

/** A warning when the provider's plan limit is nearly (or fully) used. */
function LimitChip({ provider, settings }: { provider: ProviderId; settings: AiSettings }) {
  const limit = useLimit(provider);
  const l = limit.data;
  if (!l || (!l.blocked && l.usedPercent < settings.limitWarnPercent)) return null;
  const local = settings.localFallback && !!settings.ollamaModel;
  const when = l.resetsAt ? new Date(l.resetsAt * 1000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  const title = l.blocked
    ? `${PROVIDERS[provider].label} is at its ${l.label ?? "usage"} limit${when ? ` until ${when}` : ""}.${local ? ` ${settings.ollamaModel} will answer instead.` : ""}`
    : `${Math.round(l.usedPercent)}% of ${PROVIDERS[provider].label}'s ${l.label ?? "limit"} is used${when ? ` (resets ${when})` : ""}. Type /usage for details.`;
  return (
    <span
      title={title}
      className={cn(
        "rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
        l.blocked ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
      )}
    >
      {l.blocked ? (local ? "Limit reached · using local" : "Limit reached") : `${Math.round(l.usedPercent)}% used`}
    </span>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function SetupNeeded() {
  const desktop = isDesktop();
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-muted">
          <MessagesSquare className="size-6 text-muted-foreground" strokeWidth={1.75} />
        </div>
        <h1 className="text-lg font-semibold">Connect Claude, Codex or a local model</h1>
        <p className="mt-1.5 text-muted-foreground">
          {desktop
            ? "Skele can use the Claude Code and Codex apps you're already signed in to, a local model with Ollama, or your own API key."
            : "In the browser, add an Anthropic or OpenAI API key, or use a local model with Ollama. The desktop app can also use your Claude Code and Codex sign-ins."}
        </p>
        <Button className="mt-5" asChild>
          <Link href={routes.settings("ai")}>Set up AI</Link>
        </Button>
      </div>
    </div>
  );
}

function groupChats(chats: ChatSummary[]) {
  const weekAgo = subDays(new Date(), 7);
  const groups: { label: string; items: ChatSummary[] }[] = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of chats) {
    const d = new Date(c.updatedAt);
    const g = c.pinned ? 0 : isToday(d) ? 1 : isYesterday(d) ? 2 : d > weekAgo ? 3 : 4;
    groups[g].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

function ChatList({ workspaceId, activeId, onNavigate }: { workspaceId: string; activeId: string | null; onNavigate?: () => void }) {
  const chats = useChats(workspaceId);
  const runs = useRuns((s) => s.runs);
  const prefs = usePreferences();
  const newChatCombo = resolvedShortcuts(prefs.data?.shortcuts).find((s) => s.id === "newChat")?.combo;
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = chats.data ?? [];
    return q ? list.filter((c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)) : list;
  }, [chats.data, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <Link
          href={routes.chat()}
          onClick={onNavigate}
          className="flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs transition hover:bg-accent"
        >
          <MessageSquarePlus className="size-4" strokeWidth={1.75} />
          New chat
          {newChatCombo && <Kbd className="ml-auto">{formatCombo(newChatCombo)}</Kbd>}
        </Link>
        <label className="flex h-8 items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {chats.isPending ? (
          <div className="space-y-2 px-1">
            {[70, 50, 60].map((w) => (
              <Skeleton key={w} className="h-5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{query ? "No matching chats." : "Your chats will appear here."}</p>
        ) : (
          groupChats(filtered).map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2 pb-1 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</p>
              <ul className="space-y-px">
                {g.items.map((c) => (
                  <ChatRow key={c.id} chat={c} workspaceId={workspaceId} active={c.id === activeId} running={!!runs[c.id]?.length} onNavigate={onNavigate} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ChatRow({
  chat,
  workspaceId,
  active,
  running,
  onNavigate,
}: {
  chat: ChatSummary;
  workspaceId: string;
  active: boolean;
  running: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const update = useUpdateChat();
  const remove = useDeleteChat(workspaceId);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          defaultValue={chat.title}
          aria-label="Chat name"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const title = e.currentTarget.value.trim();
            if (title && title !== chat.title) update.mutate({ id: chat.id, patch: { title: title.slice(0, 120) } });
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
        />
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <Link
        href={routes.chat(chat.id)}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg pr-8 pl-2 text-sm text-foreground/85 hover:bg-accent",
          active && "bg-accent font-medium text-foreground",
        )}
      >
        <ProviderIcon provider={chat.provider} className="size-5 rounded-md [&_svg]:size-3" />
        <span className="truncate">{chat.title}</span>
        {running && <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-brand" aria-label="Replying" />}
      </Link>
      <DropdownMenu onOpenChange={(open) => !open && setConfirm(false)}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for ${chat.title}`}
            className="absolute top-1.5 right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-background/80 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PenLine className="size-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => update.mutate({ id: chat.id, patch: { pinned: !chat.pinned } })}>
            {chat.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {chat.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              if (!confirm) {
                e.preventDefault();
                setConfirm(true);
                return;
              }
              remove.mutate(chat.id, {
                onSuccess: () => {
                  if (active) router.replace(routes.chat());
                  else if (!pathname.startsWith("/chat")) router.refresh();
                },
              });
            }}
          >
            <Trash2 className="size-4" />
            {confirm ? "Click again to delete" : "Delete"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
