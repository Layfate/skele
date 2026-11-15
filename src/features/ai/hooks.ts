"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { newId, now } from "@/data/common";
import { workspaceStore } from "@/data/registry";
import { getPage, listPages } from "@/data/repo/pages";
import { docToMarkdown } from "@/features/import-export/markdown";
import { errorMessage } from "@/lib/errors";
import { isDesktop } from "@/lib/desktop";
import * as store from "./store";
import { listAgents, mentionedAgents } from "./agents";
import { chatTokens, contextBudget } from "./context";
import { chatServers, listMcpServers, listSkills, refreshClaudeCatalog, savedClaudeCatalog, skillEntries, type SkillEntry } from "./extensions";
import { runWithFallback } from "./fallback";
import { getLedger, providerLimit, recordUsage, refreshCodexLimit } from "./limits";
import { codexModels } from "./providers/cli";
import { listOllamaModels } from "./providers/ollama";
import { resolveTarget, sessionKey, summarizeChat, titleFrom } from "./run";
import { runCommand } from "./commands";
import { isCli, type Agent, type AiSettings, type Chat, type ChatImage, type ChatMessage, type ContextPage, type ProviderId } from "./types";

export const aiKeys = {
  list: (ws: string) => ["ai-chats", ws] as const,
  one: (id: string) => ["ai-chat", id] as const,
  settings: ["ai-settings"] as const,
  mcp: ["ai-mcp"] as const,
  agents: ["ai-agents"] as const,
  skills: ["ai-skills"] as const,
  claudeCatalog: ["ai-claude-catalog"] as const,
  ledger: ["ai-ledger"] as const,
  limit: (p: ProviderId) => ["ai-limit", p] as const,
  ollamaModels: (url: string) => ["ollama-models", url] as const,
  codexModels: ["codex-models"] as const,
};

export function useAiSettings() {
  return useQuery({ queryKey: aiKeys.settings, queryFn: store.getAiSettings, staleTime: Infinity });
}

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AiSettings>) => store.updateAiSettings(patch),
    onMutate: (patch) => {
      const prev = qc.getQueryData<AiSettings>(aiKeys.settings);
      if (prev) qc.setQueryData(aiKeys.settings, { ...prev, ...patch });
    },
    onSuccess: (data) => qc.setQueryData(aiKeys.settings, data),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export const useMcpServers = () => useQuery({ queryKey: aiKeys.mcp, queryFn: listMcpServers, staleTime: Infinity });
export const useAgents = () => useQuery({ queryKey: aiKeys.agents, queryFn: listAgents, staleTime: Infinity });
export const useSkills = (enabled = true) =>
  useQuery({ queryKey: aiKeys.skills, queryFn: listSkills, enabled: enabled && isDesktop(), staleTime: 5 * 60_000 });
/**
 * Claude Code's skills, plugins and default model. Shows the saved copy at once, then asks
 * Claude Code again in the background (its free local /context command).
 */
export function useClaudeCatalog(enabled: boolean, path?: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: aiKeys.claudeCatalog,
    queryFn: async () => {
      const saved = await savedClaudeCatalog();
      const fresh = refreshClaudeCatalog(path).catch(() => null);
      if (saved) {
        // Show what we had; update when Claude Code answers.
        void fresh.then((c) => c && qc.setQueryData(aiKeys.claudeCatalog, c));
        return saved;
      }
      return (await fresh) ?? null;
    },
    enabled: enabled && isDesktop(),
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/** The "/" menu's skills and plugin commands for a provider (CLI providers only). */
export function useSkillEntries(provider: ProviderId | null, path?: string): SkillEntry[] {
  const cli = !!provider && isCli(provider) && isDesktop();
  const local = useSkills(cli);
  const catalog = useClaudeCatalog(cli && provider === "claude-cli", path);
  if (!cli) return [];
  return skillEntries(provider === "claude-cli" ? "claude" : "codex", local.data ?? [], catalog.data);
}

export const useLedger = () => useQuery({ queryKey: aiKeys.ledger, queryFn: getLedger });
export const useCodexModels = (enabled: boolean) =>
  useQuery({ queryKey: aiKeys.codexModels, queryFn: codexModels, enabled: enabled && isDesktop(), staleTime: 30 * 60_000 });
export const useOllamaModels = (settings: AiSettings | undefined, enabled = true) =>
  useQuery({
    queryKey: aiKeys.ollamaModels(settings?.ollamaUrl ?? ""),
    queryFn: () => listOllamaModels(settings!.ollamaUrl),
    enabled: enabled && !!settings,
    staleTime: 60_000,
    retry: false,
  });
/** The provider's latest plan-limit reading (CLI providers in the desktop app). */
export const useLimit = (provider: ProviderId | null) =>
  useQuery({
    queryKey: aiKeys.limit(provider ?? "ollama"),
    queryFn: () => providerLimit(provider!),
    enabled: !!provider && isCli(provider) && isDesktop(),
    staleTime: 60_000,
  });

export function useChats(workspaceId: string) {
  return useQuery({ queryKey: aiKeys.list(workspaceId), queryFn: () => store.listChats(workspaceId) });
}

export function useChat(id: string | null) {
  return useQuery({ queryKey: aiKeys.one(id ?? ""), queryFn: () => store.getChat(id!), enabled: !!id, staleTime: Infinity });
}

function saved(qc: QueryClient, chat: Chat) {
  qc.setQueryData(aiKeys.one(chat.id), chat);
  qc.invalidateQueries({ queryKey: aiKeys.list(chat.workspaceId) });
}

export function useCreateChat(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<store.NewChat, "workspaceId">) => store.createChat({ workspaceId, ...input }),
    onSuccess: (chat) => saved(qc, chat),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export type ChatPatch = Partial<Pick<Chat, "title" | "provider" | "model" | "effort" | "pinned" | "mode" | "folder" | "web" | "mcp" | "agentId">>;

export function useUpdateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch, touch }: { id: string; patch: ChatPatch; touch?: boolean }) => store.updateChat(id, (c) => ({ ...c, ...patch }), touch ?? false),
    onMutate: ({ id, patch }) => {
      const prev = qc.getQueryData<Chat>(aiKeys.one(id));
      if (prev) qc.setQueryData(aiKeys.one(id), { ...prev, ...patch });
    },
    onSuccess: (chat) => saved(qc, chat),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useDeleteChat(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      stopRun(id);
      return store.deleteChat(workspaceId, id);
    },
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: aiKeys.one(id) });
      qc.invalidateQueries({ queryKey: aiKeys.list(workspaceId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

// ── Live replies ────────────────────────────────────────────────────────────────────
// Streaming state lives outside React Query so a reply keeps going while you switch chats.
// A message can get several replies at once (one per @mentioned agent).

export type LiveRun = {
  /** Which reply this is: the agent's id, or "main". */
  key: string;
  text: string;
  thinking: string;
  activity: string[];
  provider: ProviderId;
  model: string;
  agentId?: string;
  agentName?: string;
  /** What's happening before the reply starts (summarizing, switching to the local model). */
  status?: string;
  startedAt: string;
  /** A /command Skele is answering itself. */
  local?: boolean;
};

type RunsState = {
  runs: Record<string, LiveRun[]>;
  start: (chatId: string, runs: LiveRun[]) => void;
  patch: (chatId: string, key: string, p: Partial<LiveRun>) => void;
  end: (chatId: string) => void;
};

export const useRuns = create<RunsState>()((set) => ({
  runs: {},
  start: (chatId, list) => set((s) => ({ runs: { ...s.runs, [chatId]: list } })),
  patch: (chatId, key, p) =>
    set((s) => {
      const list = s.runs[chatId];
      if (!list) return s;
      return { runs: { ...s.runs, [chatId]: list.map((r) => (r.key === key ? { ...r, ...p } : r)) } };
    }),
  end: (chatId) =>
    set((s) => {
      const runs = { ...s.runs };
      delete runs[chatId];
      return { runs };
    }),
}));

const controllers = new Map<string, AbortController>();

export function stopRun(chatId: string) {
  controllers.get(chatId)?.abort();
}

export const isRunning = (chatId: string) => controllers.has(chatId);

const MAX_CONTEXT_CHARS = 600_000;

/** Markdown of the attached pages, wrapped in <page> tags for the model. */
async function pagesContext(workspaceId: string, pages: ContextPage[]) {
  if (!pages.length) return "";
  const s = workspaceStore(workspaceId);
  const titles = new Map((await listPages(s)).pages.map((p) => [p.id, p.title || "Untitled"]));
  const parts: string[] = [];
  for (const ref of pages) {
    const page = await getPage(s, ref.id);
    const { markdown } = docToMarkdown(page.content.doc, { pageTitle: (id) => titles.get(id), filePath: () => undefined });
    const title = (page.title || "Untitled").replace(/"/g, "'");
    parts.push(`<page title="${title}">\n${markdown.trim()}\n</page>`);
  }
  const text = parts.join("\n\n");
  if (text.length > MAX_CONTEXT_CHARS) {
    throw new Error("The attached pages are too long to send in one message. Attach fewer or shorter pages.");
  }
  return text;
}

/** No title yet: "New chat", or the name of the /command it started with. */
const untitled = (c: Chat) =>
  c.title === "New chat" || (c.title.startsWith("/") && !c.messages.some((m) => m.role === "user" && !m.local));

/** Who answers a message: the agents it @mentions, else the chat's agent, else the chat's provider. */
function targetsFor(text: string, chat: Chat, agents: Agent[]): (Agent | undefined)[] {
  const mentioned = mentionedAgents(text, agents);
  if (mentioned.length) return mentioned;
  return [agents.find((a) => a.id === chat.agentId)];
}

/** Sends, regenerates and edits; replies stream into `useRuns` and are then saved. */
export function useChatActions(workspaceId: string, workspaceName?: string) {
  const qc = useQueryClient();
  const { start, patch, end } = useRuns.getState();

  async function reply(initial: Chat, targets: (Agent | undefined)[]) {
    let chat = initial;
    const [settings, mcpAll, agents] = await Promise.all([store.getAiSettings(), listMcpServers(), listAgents()]);
    const mcp = chatServers(mcpAll, chat.mcp);
    const multi = targets.length > 1 || chat.messages.some((m) => m.agentId);
    const controller = new AbortController();
    const signal = controller.signal;
    controllers.set(chat.id, controller);
    const keyOf = (a?: Agent) => a?.id ?? "main";
    start(
      chat.id,
      targets.map((a) => ({ key: keyOf(a), text: "", thinking: "", activity: [], ...resolveTarget(chat, settings, a), agentId: a?.id, agentName: a?.name, startedAt: now() })),
    );
    const setStatus = (status: string | undefined) => targets.forEach((a) => patch(chat.id, keyOf(a), { status }));

    try {
      // Long conversation going to an API or local model: summarize the older part first.
      const budgets = targets.map((a) => resolveTarget(chat, settings, a).provider).filter((p) => !isCli(p)).map((p) => contextBudget(p, settings));
      const last = chat.messages.length - 1;
      if (settings.autoCompact && budgets.length && last >= 4 && chatTokens(chat) > Math.min(...budgets) * 0.85) {
        setStatus("Summarizing earlier messages to fit the context window…");
        try {
          const text = await summarizeChat({ ...chat, messages: chat.messages.slice(0, last) }, settings, signal);
          chat = await store.updateChat(chat.id, (c) => ({ ...c, summary: { text, upTo: last, at: now() } }), false);
        } catch {
          // Not fatal: the oldest messages are left out instead.
        }
        setStatus(undefined);
      }

      const one = async (agent?: Agent) => {
        const key = keyOf(agent);
        const on = {
          text: (text: string) => patch(chat.id, key, { text, status: undefined }),
          thinking: (thinking: string) => patch(chat.id, key, { thinking, status: undefined }),
          activity: (line: string) =>
            patch(chat.id, key, { activity: [...(useRuns.getState().runs[chat.id]?.find((r) => r.key === key)?.activity ?? []), line] }),
          session: () => {},
        };
        const input = { chat, settings, workspaceName, signal, on, agent, agents, mcp, multi };
        const { result: r, fallback } = await runWithFallback(input, (local, reason) =>
          patch(chat.id, key, { text: "", thinking: "", activity: [], ...local, status: `${reason} Answering with ${local.model} instead…` }),
        );
        if (r.rateLimit) await store.saveClaudeUsage(r.rateLimit).catch(() => {});
        if (r.provider === "codex-cli") refreshCodexLimit();
        if (r.usage) await recordUsage(r.provider, r.usage).catch(() => {});
        const message: ChatMessage = {
          id: newId(),
          role: "assistant",
          content: r.text,
          thinking: r.thinking || undefined,
          activity: r.activity?.length ? r.activity : undefined,
          denied: r.denied?.length ? r.denied : undefined,
          provider: r.provider,
          model: r.model,
          modelId: r.modelId,
          effort: chat.effort,
          agentId: agent?.id,
          agentName: agent?.name,
          fallback,
          usage: r.usage,
          error: r.error,
          stopped: r.stopped,
          createdAt: now(),
        };
        return { message, sessionId: r.error || fallback ? undefined : r.sessionId, provider: r.provider, agent };
      };

      const results = await Promise.all(targets.map(one));
      const next = await store.updateChat(chat.id, (c) => {
        const upTo = c.messages.length;
        const messages = [...c.messages, ...results.map((r) => r.message)];
        const sessions = { ...c.sessions };
        for (const r of results) {
          if (r.sessionId) sessions[sessionKey(r.provider, r.agent?.id)] = { id: r.sessionId, upTo, replyId: r.message.id };
        }
        return { ...c, messages, sessions };
      });
      saved(qc, next);
      qc.invalidateQueries({ queryKey: aiKeys.ledger });
      qc.invalidateQueries({ queryKey: ["ai-limit"] });
    } finally {
      controllers.delete(chat.id);
      end(chat.id);
    }
  }

  async function guarded(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return {
    send: (chatId: string, text: string, pages: ContextPage[] = [], images: ChatImage[] = []) =>
      guarded(async () => {
        if (controllers.has(chatId)) return;
        const context = await pagesContext(workspaceId, pages);
        const message: ChatMessage = {
          id: newId(),
          role: "user",
          content: text,
          pages: pages.length ? pages : undefined,
          context: context || undefined,
          images: images.length ? images : undefined,
          createdAt: now(),
        };
        const chat = await store.updateChat(chatId, (c) => ({
          ...c,
          title: untitled(c) ? titleFrom(text || pages[0]?.title || (images.length ? "Image" : "New chat")) : c.title,
          messages: [...c.messages, message],
        }));
        saved(qc, chat);
        await reply(chat, targetsFor(text, chat, await listAgents()));
      }),
    /** Replaces the replies to the last message with new ones. */
    regenerate: (chatId: string) =>
      guarded(async () => {
        if (controllers.has(chatId)) return;
        const chat = await store.updateChat(chatId, (c) => {
          const lastUser = c.messages.map((m) => m.role).lastIndexOf("user");
          // The CLI sessions already contain the old replies; start them over.
          return { ...c, messages: c.messages.slice(0, lastUser + 1), sessions: {} };
        });
        saved(qc, chat);
        const last = chat.messages[chat.messages.length - 1];
        await reply(chat, targetsFor(last?.content ?? "", chat, await listAgents()));
      }),
    /** Changes a user message, drops everything after it and replies again. */
    edit: (chatId: string, messageId: string, text: string) =>
      guarded(async () => {
        if (controllers.has(chatId)) return;
        const chat = await store.updateChat(chatId, (c) => {
          const i = c.messages.findIndex((m) => m.id === messageId);
          if (i < 0) return c;
          const messages = c.messages.slice(0, i + 1);
          messages[i] = { ...messages[i], content: text };
          // A summary covering messages that no longer exist is dropped too.
          const summary = c.summary && c.summary.upTo <= i ? c.summary : undefined;
          return { ...c, messages, sessions: {}, summary };
        });
        saved(qc, chat);
        await reply(chat, targetsFor(text, chat, await listAgents()));
      }),
    /** A /command Skele answers itself; nothing is sent to a model (except /compact's summary). */
    command: (chatId: string, name: string, args = "") =>
      guarded(async () => {
        if (controllers.has(chatId)) return;
        const controller = new AbortController();
        controllers.set(chatId, controller);
        try {
          const asked: ChatMessage = { id: newId(), role: "user", content: `/${name}${args ? ` ${args}` : ""}`, local: true, createdAt: now() };
          const chat = await store.updateChat(chatId, (c) => ({
            ...c,
            title: c.messages.length === 0 && c.title === "New chat" ? `/${name}` : c.title,
            messages: [...c.messages, asked],
          }));
          saved(qc, chat);
          start(chatId, [{ key: "main", text: "", thinking: "", activity: [], provider: chat.provider, model: chat.model, startedAt: now(), local: true }]);
          const [settings, mcp, agents] = await Promise.all([store.getAiSettings(), listMcpServers(), listAgents()]);
          let answer: { content: string; card?: ChatMessage["card"]; error?: string; patch?: Partial<Chat>; summary?: string } = await runCommand(
            name,
            args,
            chat,
            settings,
            { mcp, agents },
          ).catch((e) => ({ content: "", error: errorMessage(e) }));
          if ("compact" in answer && answer.compact) {
            patch(chatId, "main", { status: "Summarizing the conversation so far…" });
            const before = { ...chat, messages: chat.messages.slice(0, -1) };
            answer = await summarizeChat(before, settings, controller.signal)
              .then((summary) => ({
                content: `**Summary of the conversation so far**\n\n${summary}\n\n_From now on, the messages above are sent as this summary._`,
                summary,
              }))
              .catch((e) => ({ content: "", error: `Couldn't summarize: ${errorMessage(e)}` }));
          }
          const message: ChatMessage = {
            id: newId(),
            role: "assistant",
            content: answer.content,
            card: answer.card,
            error: answer.error,
            local: true,
            createdAt: now(),
          };
          saved(
            qc,
            await store.updateChat(chatId, (c) => {
              const messages = [...c.messages, message];
              const next: Chat = { ...c, ...answer.patch, messages };
              // After /compact, CLI sessions start over from the summary.
              if (answer.summary) Object.assign(next, { summary: { text: answer.summary, upTo: messages.length, at: now() }, sessions: {} });
              return next;
            }),
          );
        } finally {
          controllers.delete(chatId);
          end(chatId);
        }
      }),
    stop: stopRun,
  };
}
