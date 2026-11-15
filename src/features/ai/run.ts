// One chat turn: picks the provider (the chat's, an agent's, or the local fallback), builds
// what it needs (a fitted history for APIs and local models; a resumed session plus anything
// it missed for the CLIs) and streams the reply.

import { isDesktop } from "@/lib/desktop";
import { claudeSubagents } from "./agents";
import { buildHistory, compactPrompt, contextBudget, historyStart, messageText, summaryBlock, transcript, turnImages } from "./context";
import { toSpec } from "./extensions";
import { streamAnthropic } from "./providers/anthropic";
import { runCli } from "./providers/cli";
import { streamOllama } from "./providers/ollama";
import { streamOpenAI } from "./providers/openai";
import { noHandlers, type TurnHandlers, type TurnMessage, type TurnResult } from "./providers/types";
import { effortFor, isCli, prettyModel, PROVIDERS, type Agent, type AiSettings, type Chat, type ChatMessage, type Effort, type McpServer, type ProviderId } from "./types";

export { messageText };

/** Skele's own commands; any other "/name" is a skill (passed to the CLI). */
export const SKELE_COMMANDS = new Set(["usage", "status", "new", "help", "compact", "model", "effort", "mode", "mcp", "skills", "plugins", "agents"]);

/** The skill a message invokes ("/pdf-tools fill this form"), if any. */
export function skillInvocation(text: string): string | null {
  const m = /^\/([a-z0-9][a-z0-9:-]{0,80})(\s|$)/.exec(text.trim());
  return m && !SKELE_COMMANDS.has(m[1]) ? m[1] : null;
}

export function systemPrompt(
  settings: AiSettings,
  workspaceName?: string,
  ctx: { mode?: Chat["mode"]; folder?: string; agent?: Agent; multi?: boolean; mcp?: string[]; provider?: ProviderId; model?: string; effort?: Effort } = {},
) {
  const model = ctx.model ? prettyModel(ctx.model) : "";
  const parts = [
    "You are the AI assistant inside Skele, a calm, local-first app for notes, tasks, projects and databases.",
    ctx.provider
      ? `This chat runs on ${PROVIDERS[ctx.provider].label}${model ? ` with the model ${model}` : ""}${ctx.effort && ctx.provider !== "ollama" ? `, at ${effortFor(ctx.provider, ctx.effort)} effort` : ""}; the user can change both below the message box.`
      : "",
    "The user can paste images into a message; when they do, they're attached to it.",
    ctx.agent ? `In this conversation you are "@${ctx.agent.name}". ${ctx.agent.instructions.trim()}` : "",
    workspaceName ? `The user's current workspace is called "${workspaceName}".` : "",
    "When the user attaches pages, their content is given inside <page> tags; use it to answer and refer to pages by title.",
    ctx.mode === "read" && ctx.folder ? `You can read files in the folder ${ctx.folder} with your tools. You can't change files.` : "",
    ctx.mode === "edit" && ctx.folder
      ? `You can read and change files in the folder ${ctx.folder} with your tools. Make only the changes the user asks for, and say which files you changed.`
      : "",
    ctx.mcp?.length ? `Tools from these MCP servers are available: ${ctx.mcp.join(", ")}.` : "",
    ctx.multi
      ? "Several assistants may reply in this conversation; replies from others are marked with their @name. Don't start your own reply with your name or a label."
      : "",
    "Write in GitHub-flavored Markdown. Keep answers clear and well organized; use headings, lists, tables and fenced code blocks when they help, and stay brief when a short answer is enough.",
    settings.instructions.trim() ? `The user's own instructions: ${settings.instructions.trim()}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Whether a provider can be used here (CLIs need the desktop app; APIs need a key; Ollama a model). */
export function providerAvailable(id: ProviderId, settings: AiSettings) {
  if (PROVIDERS[id].kind === "cli") return isDesktop();
  if (id === "ollama") return !!settings.ollamaModel;
  return id === "anthropic" ? !!settings.anthropicKey : !!settings.openaiKey;
}

export function defaultProvider(settings: AiSettings): ProviderId | null {
  if (settings.defaultProvider && providerAvailable(settings.defaultProvider, settings)) return settings.defaultProvider;
  const order: ProviderId[] = ["claude-cli", "anthropic", "codex-cli", "openai", "ollama"];
  return order.find((id) => providerAvailable(id, settings)) ?? null;
}

/** Where a CLI session is remembered: per provider, and per agent. */
export const sessionKey = (provider: ProviderId, agentId?: string) => (agentId ? `${provider}:${agentId}` : provider);

/** Provider and model a turn uses: overrides, then the agent's own, then the chat's. */
export function resolveTarget(chat: Chat, settings: AiSettings, agent?: Agent, override?: { provider: ProviderId; model: string }) {
  const provider = override?.provider ?? agent?.provider ?? chat.provider;
  let model = override ? override.model : agent?.provider ? agent.model : chat.model;
  if (!model && provider === "openai") model = settings.openaiModel;
  if (!model && provider === "ollama") model = settings.ollamaModel;
  return { provider, model };
}

function label(m: ChatMessage) {
  if (m.role === "user") return "User";
  if (m.agentName) return `Assistant (@${m.agentName})`;
  return m.provider ? `Assistant (${PROVIDERS[m.provider].short})` : "Assistant";
}

export type TurnInput = {
  chat: Chat;
  settings: AiSettings;
  workspaceName?: string;
  signal: AbortSignal;
  on: TurnHandlers;
  /** The agent answering (none: the chat's provider as itself). */
  agent?: Agent;
  /** All agents (Claude Code can delegate to those marked as sub-agents). */
  agents?: Agent[];
  /** MCP servers this chat turned on. */
  mcp?: McpServer[];
  /** Several agents are answering this message. */
  multi?: boolean;
  /** Answer with this provider/model instead (the local fallback). */
  override?: { provider: ProviderId; model: string };
};

/** Runs the reply to the last message in `chat.messages` (a user message). */
export async function runTurn(input: TurnInput): Promise<TurnResult & { provider: ProviderId; model: string }> {
  const { chat, settings, signal, on, agent } = input;
  const { provider, model } = resolveTarget(chat, settings, agent, input.override);
  const done = (r: TurnResult) => ({ ...r, provider, model });
  const n = chat.messages.length - 1;
  const last = chat.messages[n];
  if (!last || last.role !== "user") return done({ text: "", error: "Nothing to reply to." });
  const cli = isCli(provider);
  const mcp = cli ? (input.mcp ?? []) : [];
  const system = systemPrompt(settings, input.workspaceName, {
    mode: cli ? chat.mode : undefined,
    folder: chat.folder,
    agent,
    multi: input.multi,
    mcp: mcp.map((s) => s.name),
    provider,
    model,
    effort: chat.effort,
  });

  if (!cli) {
    const history = buildHistory(chat, contextBudget(provider, settings), { provider, agentId: agent?.id });
    const args = { model, effort: chat.effort, system, messages: history.messages, showThinking: settings.showThinking, signal, on };
    if (provider === "ollama") {
      return done(await streamOllama({ ...args, url: settings.ollamaUrl, numCtx: settings.ollamaContext }));
    }
    return done(
      provider === "anthropic"
        ? await streamAnthropic({ ...args, apiKey: settings.anthropicKey })
        : await streamOpenAI({ ...args, apiKey: settings.openaiKey }),
    );
  }

  // CLI: resume the tool's own session when it has seen everything before this message;
  // otherwise tell it what it missed (replies other providers or agents gave in between).
  const tool = provider === "claude-cli" ? "claude" : "codex";
  const known = chat.sessions?.[sessionKey(provider, agent?.id)];
  const session = known && known.upTo <= n ? known : undefined;
  const start = session ? session.upTo : historyStart(chat);
  const missed = chat.messages.slice(start, n).filter((m) => !m.local && m.id !== session?.replyId);
  const skill = skillInvocation(last.content);
  // A /skill command has to come first to be recognised, so attached pages follow it.
  let prompt = skill && last.context ? `${last.content}\n\n${last.context}` : messageText(last);
  if (skill && tool === "codex") prompt = prompt.replace(/^\s*\//, "$"); // Codex mentions skills as $name
  if (!prompt.trim() && last.images?.length) prompt = "(See the attached image.)";
  const context = [
    !session && start > 0 && chat.summary ? summaryBlock(chat.summary.text) : "",
    missed.some((m) => m.content.trim()) ? `Earlier in this conversation (for context):\n\n${transcript(missed, label)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (context) {
    // A /skill command has to stay first to be recognised; context then follows it.
    prompt = skill ? `${prompt}\n\n---\n\n${context}` : `${context}\n\n---\n\n${prompt}`;
  }
  if (tool === "codex" && !session) {
    // Codex has no system-prompt option; give the instructions with the first message.
    const access =
      chat.mode === "edit"
        ? "You may change files in the current folder when the user asks for it."
        : chat.mode === "read"
          ? "You may read files in the current folder to answer, but don't modify anything."
          : "This is a conversation, not a coding task: answer directly and don't modify files.";
    prompt = `<instructions>\n${system}\n${access}\n</instructions>\n\n${prompt}`;
  }
  return done(
    await runCli({
      tool,
      prompt,
      model,
      effort: chat.effort,
      sessionId: session?.id,
      systemPrompt: tool === "claude" ? system : undefined,
      path: tool === "claude" ? settings.claudePath : settings.codexPath,
      mode: chat.mode ?? "chat",
      folder: chat.folder,
      web: !!chat.web,
      mcpServers: mcp.map(toSpec),
      useCliExtensions: settings.useCliExtensions,
      allowSkills: !!skill,
      agents: tool === "claude" ? claudeSubagents(input.agents ?? [], agent?.id) : undefined,
      images: turnImages(last),
      signal,
      on,
    }),
  );
}

/** A summary of the conversation so far, from the chat's own provider (for /compact). */
export async function summarizeChat(chat: Chat, settings: AiSettings, signal: AbortSignal): Promise<string> {
  const { provider, model } = resolveTarget(chat, settings);
  const start = historyStart(chat);
  // Keep the newest part if the transcript alone wouldn't fit.
  const maxChars = contextBudget(provider, settings) * 4 - 4000;
  const full = transcript(chat.messages.slice(start), label);
  const text = full.length > maxChars ? `[…]\n${full.slice(-maxChars)}` : full;
  if (!text.trim()) throw new Error("There's nothing to summarize yet.");
  const prompt = compactPrompt(text, start > 0 ? chat.summary?.text : undefined);
  const system = "You write concise, faithful summaries of conversations.";
  const messages: TurnMessage[] = [{ role: "user", content: prompt }];
  let result: TurnResult;
  if (isCli(provider)) {
    result = await runCli({
      tool: provider === "claude-cli" ? "claude" : "codex",
      prompt: provider === "codex-cli" ? `<instructions>${system} Don't run commands or modify files.</instructions>\n\n${prompt}` : prompt,
      model,
      effort: "low",
      systemPrompt: provider === "claude-cli" ? system : undefined,
      path: provider === "claude-cli" ? settings.claudePath : settings.codexPath,
      ephemeral: true,
      signal,
      on: noHandlers,
    });
  } else if (provider === "ollama") {
    result = await streamOllama({ url: settings.ollamaUrl, model, system, messages, numCtx: settings.ollamaContext, showThinking: false, signal, on: noHandlers });
  } else {
    const args = { model, effort: "low" as const, system, messages, showThinking: false, signal, on: noHandlers };
    result = provider === "anthropic" ? await streamAnthropic({ ...args, apiKey: settings.anthropicKey }) : await streamOpenAI({ ...args, apiKey: settings.openaiKey });
  }
  if (result.stopped) throw new Error("Stopped.");
  if (result.error) throw new Error(result.error);
  if (!result.text.trim()) throw new Error("The model didn't return a summary.");
  return result.text.trim();
}

/** A short title from the first message. */
export function titleFrom(text: string) {
  const line = text.replace(/[#>*_`]/g, "").split("\n").find((l) => l.trim())?.trim() ?? "New chat";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}
