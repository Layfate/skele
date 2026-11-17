// Keeping what's sent to a model small: page text attached more than once is sent once, a
// /compact summary replaces the messages it covers, and when a conversation still doesn't
// fit, the oldest messages are left out (with a note saying so).

import type { TurnImage, TurnMessage } from "./providers/types";
import type { AiSettings, Chat, ChatMessage, ProviderId } from "./types";

/** Rough token count (about 4 characters per token for English; close enough for budgets). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Rough tokens for one image (images are downscaled to about 1568 px before sending). */
export const IMAGE_TOKENS = 1600;

/** A message's images as the providers take them. */
export const turnImages = (m: ChatMessage): TurnImage[] | undefined =>
  m.role === "user" && m.images?.length ? m.images.map((i) => ({ mediaType: i.mediaType, data: i.data })) : undefined;

const imagesNote = (m: ChatMessage) => (m.images?.length ? ` [${m.images.length === 1 ? "an image" : `${m.images.length} images`} attached]` : "");

/** How many tokens of conversation to send, leaving room for the system prompt and the reply. */
export function contextBudget(provider: ProviderId, settings: Pick<AiSettings, "ollamaContext"> & Partial<Pick<AiSettings, "openrouterContext">>): number {
  switch (provider) {
    case "ollama":
      // Small windows: keep a quarter for the reply.
      return Math.max(1024, Math.floor(settings.ollamaContext * 0.75) - 300);
    case "openrouter":
      // Windows range from 4K to 2M tokens; the chosen model's comes from OpenRouter's list.
      return Math.max(1024, Math.min(150_000, Math.floor((settings.openrouterContext || 32_000) * 0.75) - 300));
    case "openai":
      return 100_000;
    case "anthropic":
    case "claude-cli":
    case "codex-cli":
      return 150_000;
  }
}

/** What the model sees for one message (attached page text first). */
export function messageText(m: ChatMessage) {
  return m.role === "user" && m.context ? `${m.context}\n\n${m.content}` : m.content;
}

const PAGE_BLOCK = /<page title="([^"]*)">\n[\s\S]*?\n<\/page>/g;

/**
 * Page text attached again later in the conversation is sent only with its newest copy;
 * earlier copies become a one-line reference. Pages that changed in between are kept.
 */
export function dedupePages(texts: string[]): string[] {
  const newest = new Map<string, number>();
  texts.forEach((t, i) => {
    for (const m of t.matchAll(PAGE_BLOCK)) newest.set(m[0], i);
  });
  return texts.map((t, i) =>
    t.replace(PAGE_BLOCK, (block, title: string) =>
      newest.get(block) === i ? block : `<page title="${title}">(The same text is attached again further down.)</page>`,
    ),
  );
}

/** Messages a model should see: not Skele's own /command answers, and not empty replies. */
export function modelMessages(messages: ChatMessage[]) {
  return messages.filter((m) => !m.local && (m.role === "user" || m.content.trim().length > 0));
}

/** Index where the history starts: after the /compact summary, if there's a valid one. */
export function historyStart(chat: Pick<Chat, "summary" | "messages">) {
  const s = chat.summary;
  return s && s.upTo > 0 && s.upTo <= chat.messages.length ? s.upTo : 0;
}

export const summaryBlock = (text: string) =>
  `<conversation_summary>\nA summary of the earlier part of this conversation:\n\n${text.trim()}\n</conversation_summary>`;

const OMITTED = "[Some earlier messages were left out to fit the model's context window.]";

/** Labels replies by other providers/agents so a model can tell who said what. */
function speaker(m: ChatMessage, self: { provider: ProviderId; agentId?: string }) {
  if (m.role !== "assistant") return "";
  const other = m.agentId ? m.agentId !== self.agentId : m.provider && m.provider !== self.provider;
  if (!other) return "";
  return `[Reply from ${m.agentName ? `@${m.agentName}` : "another assistant"}]\n`;
}

export type History = { messages: TurnMessage[]; tokens: number; omitted: number };

/**
 * The conversation for an API or local model, fitted into `budget` tokens. The last message
 * (the one being answered) is always kept.
 */
export function buildHistory(chat: Pick<Chat, "summary" | "messages">, budget: number, self: { provider: ProviderId; agentId?: string }): History {
  const start = historyStart(chat);
  const msgs = modelMessages(chat.messages.slice(start));
  const texts = dedupePages(msgs.map(messageText));
  let turns: TurnMessage[] = msgs.map((m, i) => ({ role: m.role, content: speaker(m, self) + texts[i], images: turnImages(m) }));
  const summary = start > 0 && chat.summary ? summaryBlock(chat.summary.text) : "";
  const cost = (list: TurnMessage[]) =>
    list.reduce((n, t) => n + estimateTokens(t.content) + 4 + (t.images?.length ?? 0) * IMAGE_TOKENS, estimateTokens(summary));

  let omitted = 0;
  while (turns.length > 1 && cost(turns) > budget) {
    turns = turns.slice(1);
    omitted++;
  }
  // APIs want the first message to be the user's.
  while (turns.length > 1 && turns[0].role !== "user") {
    turns = turns.slice(1);
    omitted++;
  }
  // Still too long (one huge message): cut its middle.
  if (turns.length === 1 && cost(turns) > budget) {
    const keep = Math.max(1000, (budget - estimateTokens(summary)) * 4 - 200);
    const c = turns[0].content;
    turns = [{ ...turns[0], content: `${c.slice(0, keep / 2)}\n\n[… text left out to fit the context window …]\n\n${c.slice(-keep / 2)}` }];
  }
  const prefix = [summary, omitted ? OMITTED : ""].filter(Boolean).join("\n\n");
  if (prefix && turns[0]) turns[0] = { ...turns[0], content: `${prefix}\n\n${turns[0].content}` };
  return { messages: turns, tokens: cost(turns), omitted };
}

/** Estimated tokens the next message would send (for the composer's context meter). */
export function chatTokens(chat: Pick<Chat, "summary" | "messages">) {
  const start = historyStart(chat);
  const texts = dedupePages(modelMessages(chat.messages.slice(start)).map(messageText));
  const summary = start > 0 && chat.summary ? estimateTokens(summaryBlock(chat.summary.text)) : 0;
  const images = modelMessages(chat.messages.slice(start)).reduce((n, m) => n + (m.images?.length ?? 0), 0);
  return texts.reduce((n, t) => n + estimateTokens(t) + 4, summary) + images * IMAGE_TOKENS;
}

/** A plain transcript (for catching a CLI up, and for summarising). */
export function transcript(messages: ChatMessage[], label: (m: ChatMessage) => string) {
  return modelMessages(messages)
    .filter((m) => m.content.trim() || m.images?.length)
    .map((m) => `${label(m)}: ${messageText(m)}${imagesNote(m)}`)
    .join("\n\n");
}

export function compactPrompt(text: string, previous?: string) {
  return [
    "Summarize the conversation below so it can replace the original messages in a later conversation with an AI assistant.",
    "Keep every fact, decision, name, number, file path, code snippet and open question that might matter later, and what the user wants. Leave out pleasantries.",
    "Write it as compact Markdown notes (headings and bullet points), in the conversation's language. Reply with the summary only.",
    previous ? `\n<earlier_summary>\n${previous}\n</earlier_summary>` : "",
    `\n<conversation>\n${text}\n</conversation>`,
  ].join("\n");
}
