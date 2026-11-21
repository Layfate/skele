// AI workspace: providers, models, access modes, agents, MCP servers and the stored chat shape.

export type ProviderId = "claude-cli" | "codex-cli" | "ollama" | "anthropic" | "openai" | "openrouter";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Effort levels, from fastest to smartest (as in Claude Code's /effort). */
export const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: "low", label: "low", hint: "Fastest replies, least reasoning" },
  { id: "medium", label: "medium", hint: "Good for most questions" },
  { id: "high", label: "high", hint: "Thinks longer on hard problems" },
  { id: "xhigh", label: "xhigh", hint: "Deeper reasoning for complex work" },
  { id: "max", label: "max", hint: "Thinks as long as it needs; slowest and most usage" },
];

/** The highest effort a provider accepts (Ollama has no effort setting). */
export function maxEffort(provider: ProviderId): Effort | null {
  switch (provider) {
    case "claude-cli":
    case "anthropic":
    case "openrouter":
      return "max";
    case "codex-cli":
      return "xhigh";
    case "openai":
      return "high";
    case "ollama":
      return null;
  }
}

/** The effort actually sent: the chosen one, lowered to what the provider supports. */
export function effortFor(provider: ProviderId, effort: Effort): Effort {
  const max = maxEffort(provider);
  if (!max) return effort;
  const ids = EFFORTS.map((e) => e.id);
  return ids.indexOf(effort) > ids.indexOf(max) ? max : effort;
}

export const isEffort = (s: string): s is Effort => EFFORTS.some((e) => e.id === s);

/**
 * What a chat's AI may do on this computer (CLI providers only).
 * - chat: nothing; it only talks.
 * - read: read files in the chat's folder.
 * - edit: read and change files in the chat's folder (never runs shell commands outside a
 *   sandbox: Claude Code gets no shell, Codex runs commands in its workspace sandbox).
 * - full: like the CLI in a terminal: reads and edits anywhere, starting in the chat's folder
 *   (the home folder when none is set), and uses every MCP server, plugin, skill and
 *   connector set up in Claude Code / Codex. Shell commands only with the chat's `shell`.
 */
export type AccessMode = "chat" | "read" | "edit" | "full";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Short name shown on messages. */
  short: string;
  family: "claude" | "codex" | "local" | "router";
  /** "cli": the user's own signed-in command-line tool (desktop app only). "api": an API key. "local": a model on this computer. */
  kind: "cli" | "api" | "local";
  description: string;
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  "claude-cli": {
    id: "claude-cli",
    label: "Claude Code",
    short: "Claude",
    family: "claude",
    kind: "cli",
    description: "Uses the Claude Code app on this computer and the account it's signed in to.",
  },
  "codex-cli": {
    id: "codex-cli",
    label: "Codex",
    short: "Codex",
    family: "codex",
    kind: "cli",
    description: "Uses the Codex app on this computer and the account it's signed in to.",
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    short: "Local",
    family: "local",
    kind: "local",
    description: "Runs open models on this computer with Ollama. Private, free and works offline.",
  },
  anthropic: {
    id: "anthropic",
    label: "Claude API",
    short: "Claude",
    family: "claude",
    kind: "api",
    description: "Calls the Claude API with your own Anthropic API key.",
  },
  openai: {
    id: "openai",
    label: "OpenAI API",
    short: "Codex",
    family: "codex",
    kind: "api",
    description: "Calls the OpenAI API with your own API key (Codex and GPT models).",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    short: "OpenRouter",
    family: "router",
    kind: "api",
    description: "Hundreds of models (Claude, GPT, Gemini, Llama, DeepSeek, Qwen…) with one OpenRouter API key.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/** Providers that can read/edit files and use MCP servers, plugins and skills. */
export const isCli = (p: ProviderId): p is "claude-cli" | "codex-cli" => PROVIDERS[p].kind === "cli";

export type ModelOption = { id: string; label: string; hint?: string };

/** "" = the tool's own default (whatever the CLI is configured to use). The aliases always
 * point at the newest version of each model; the labels say which one that is. */
export const CLAUDE_CLI_MODELS: ModelOption[] = [
  { id: "", label: "Default", hint: "Claude Code's configured model" },
  { id: "opus", label: "Opus 5.5", hint: "For complex work and everyday tasks" },
  { id: "sonnet", label: "Sonnet 5.5", hint: "Most efficient for simpler tasks" },
  { id: "fable", label: "Fable 5.2", hint: "For your toughest challenges" },
  { id: "haiku", label: "Haiku 5.5", hint: "Fastest for quick answers" },
];

/** Earlier versions Claude Code can still use (its "More models"). */
export const CLAUDE_MORE_MODELS: ModelOption[] = [
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

/** What each Claude Code alias currently resolves to. */
export const CLAUDE_ALIASES: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  fable: "claude-fable-5-2",
  haiku: "claude-haiku-5-5",
};

/**
 * A readable name for a model id: "claude-opus-5-5" → "Opus 5.5", "claude-fable-5-2[1m]" →
 * "Fable 5.2 (1M)", "opus" → "Opus 5.5". Anything else is returned as it is.
 */
export function prettyModel(id: string): string {
  const raw = id.trim();
  if (!raw) return "";
  const alias = CLAUDE_ALIASES[raw.toLowerCase()];
  if (alias) return prettyModel(alias);
  const m = /^(?:anthropic\.)?claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(raw);
  if (!m) return raw;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}${m[4] ? " (1M)" : ""}`;
}

export const CODEX_DEFAULT_MODEL: ModelOption = { id: "", label: "Default", hint: "Codex's configured model" };

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Default · most capable Opus" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Fast and capable" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fastest, lowest cost" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", hint: "Most capable, highest cost" },
];

export const DEFAULT_MODEL: Record<ProviderId, string> = {
  "claude-cli": "",
  "codex-cli": "",
  ollama: "",
  anthropic: "claude-opus-5-5",
  openai: "",
  openrouter: "",
};

/** A page sent with a message. `auto`: attached because the message names it. */
export type ContextPage = { id: string; title: string; icon?: string | null; auto?: boolean };

/** An image sent with a message (pasted or attached), downscaled and stored as base64. */
export type ChatImage = {
  id: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /** Base64, no `data:` prefix. */
  data: string;
  width: number;
  height: number;
  name?: string;
};

export const MAX_CHAT_IMAGES = 10;

/** Tokens and cost of one reply, as the provider reported them. */
export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Input served from the provider's prompt cache. */
  cachedTokens?: number;
  /** Claude Code reports what the turn would cost at API prices. */
  costUsd?: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  /** What the user typed / the reply, as Markdown. */
  content: string;
  /** Attached pages (user messages). Their text is in `context`. */
  pages?: ContextPage[];
  /** Page text sent to the model with this message (not shown). */
  context?: string;
  /** Images sent with this message (user messages). */
  images?: ChatImage[];
  /** Summarised reasoning, when the provider returns it. */
  thinking?: string;
  /** Steps a tool-using agent took (files read, searches, MCP tools), shown collapsed. */
  activity?: string[];
  /** Tool uses this chat's access mode didn't allow. */
  denied?: string[];
  provider?: ProviderId;
  model?: string;
  /** The exact model that answered, when the provider reported it (e.g. "claude-opus-5-5"). */
  modelId?: string;
  /** Effort the reply was made with. */
  effort?: Effort;
  /** The agent that wrote this reply (multi-agent chats). */
  agentId?: string;
  agentName?: string;
  /** Answered by the local model because the chosen provider couldn't. */
  fallback?: { from: ProviderId; reason: string };
  usage?: TurnUsage;
  error?: string;
  stopped?: boolean;
  /** Answered by Skele itself (a /command), not sent to any model. */
  local?: boolean;
  card?: InfoCard;
  createdAt: string;
};

/** One limit window, e.g. "5 hours: 26% used, resets 15:30". */
export type UsageWindow = { label: string; usedPercent: number; resetsAt?: number };
export type UsageBlock = { tool: string; plan?: string; windows: UsageWindow[]; asOf?: string; note?: string };
export type InfoCard = { kind: "usage"; blocks: UsageBlock[]; notes?: string[] };

/** A CLI session and what it has seen: messages before `upTo`, plus its own reply `replyId`. */
export type CliSession = { id: string; upTo: number; replyId?: string };

export type Chat = {
  id: string;
  workspaceId: string;
  title: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  /** What the AI may do (CLI providers). Defaults to "chat". */
  mode?: AccessMode;
  /** The folder "read" / "edit" work in; where "full" starts (home when unset). */
  folder?: string;
  /** "full" only: the AI may also run shell commands. */
  shell?: boolean;
  /** Allow web search and fetching pages. */
  web?: boolean;
  /** Skele MCP servers this chat uses (ids). */
  mcp?: string[];
  /** The agent answering by default (none: the plain provider). */
  agentId?: string;
  /** Summary of everything before `upTo`, made by /compact; replaces those messages. */
  summary?: { text: string; upTo: number; at: string };
  /** CLI session per provider (and per agent: "claude-cli:<agentId>"). */
  sessions?: Partial<Record<string, CliSession>>;
  messages: ChatMessage[];
};

export type ChatSummary = Pick<Chat, "id" | "title" | "provider" | "pinned" | "createdAt" | "updatedAt"> & { preview: string };

/** A reusable assistant: its own instructions, and optionally its own provider and model. */
export type Agent = {
  id: string;
  /** Handle used to @mention it (letters, digits, - and _). */
  name: string;
  description: string;
  instructions: string;
  /** null: whatever the chat uses. */
  provider: ProviderId | null;
  model: string;
  /** Also offer it to Claude Code as a sub-agent it can hand work to. */
  subagent: boolean;
  createdAt: string;
  updatedAt: string;
};

/** An MCP server Skele hands to Claude Code / Codex for the chats that turn it on. */
export type McpServer = {
  id: string;
  /** Name the tools appear under (letters, digits, - and _). */
  name: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  /** Available to chats at all. */
  enabled: boolean;
  /** Turned on in new chats automatically. */
  autoAttach: boolean;
  /** Where the preset came from, if any. */
  preset?: string;
  createdAt: string;
};

export type AiSettings = {
  defaultProvider: ProviderId | null;
  anthropicKey: string;
  openaiKey: string;
  /** Last OpenAI model used (the list comes from the account). */
  openaiModel: string;
  openrouterKey: string;
  /** Last OpenRouter model used, e.g. "anthropic/claude-sonnet-4.5". */
  openrouterModel: string;
  /** Its context window (tokens), from OpenRouter's model list. */
  openrouterContext: number;
  /** OpenRouter models picked recently, newest first (shown in the model menu). */
  openrouterRecent: string[];
  /** Overrides for where the CLIs are installed (desktop). */
  claudePath: string;
  codexPath: string;
  ollamaPath: string;
  /** Ollama server address. */
  ollamaUrl: string;
  /** Last Ollama model used. */
  ollamaModel: string;
  /** Context window to ask Ollama for (tokens). */
  ollamaContext: number;
  /** When Claude Code / Codex / an API can't answer (limit reached, offline, not installed), answer with the local model. */
  localFallback: boolean;
  /** Extra instructions added to every chat. */
  instructions: string;
  /** Show the model's reasoning summary when available. */
  showThinking: boolean;
  /** Access mode for new chats. */
  defaultMode: AccessMode;
  /** Let the CLIs also use their own MCP servers, plugins and skills (not just Skele's). */
  useCliExtensions: boolean;
  /** Summarise older messages automatically when a conversation gets long (API and local models). */
  autoCompact: boolean;
  /** Warn before sending when a plan limit is at least this full (percent). */
  limitWarnPercent: number;
  /**
   * The AI knows the workspace's page titles, gets the pages a message names attached, and
   * (API models) can search and read pages and databases itself.
   */
  workspaceAccess: boolean;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  defaultProvider: null,
  anthropicKey: "",
  openaiKey: "",
  openaiModel: "",
  openrouterKey: "",
  openrouterModel: "",
  openrouterContext: 32_000,
  openrouterRecent: [],
  claudePath: "",
  codexPath: "",
  ollamaPath: "",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
  ollamaContext: 8192,
  localFallback: true,
  instructions: "",
  showThinking: true,
  defaultMode: "chat",
  useCliExtensions: false,
  autoCompact: true,
  limitWarnPercent: 90,
  workspaceAccess: true,
};
