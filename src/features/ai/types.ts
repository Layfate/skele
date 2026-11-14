// AI workspace: providers, models, access modes, agents, MCP servers and the stored chat shape.

export type ProviderId = "claude-cli" | "codex-cli" | "ollama" | "anthropic" | "openai";
export type Effort = "low" | "medium" | "high";

/**
 * What a chat's AI may do on this computer (CLI providers only).
 * - chat: nothing; it only talks.
 * - read: read files in the chat's folder.
 * - edit: read and change files in the chat's folder (never runs shell commands outside a
 *   sandbox: Claude Code gets no shell, Codex runs commands in its workspace sandbox).
 */
export type AccessMode = "chat" | "read" | "edit";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Short name shown on messages. */
  short: string;
  family: "claude" | "codex" | "local";
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
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/** Providers that can read/edit files and use MCP servers, plugins and skills. */
export const isCli = (p: ProviderId): p is "claude-cli" | "codex-cli" => PROVIDERS[p].kind === "cli";

export type ModelOption = { id: string; label: string; hint?: string };

/** "" = the tool's own default (whatever the CLI is configured to use). */
export const CLAUDE_CLI_MODELS: ModelOption[] = [
  { id: "", label: "Default", hint: "Claude Code's configured model" },
  { id: "fable", label: "Fable", hint: "Most capable" },
  { id: "opus", label: "Opus", hint: "Capable and quick" },
  { id: "sonnet", label: "Sonnet", hint: "Fast and capable" },
  { id: "haiku", label: "Haiku", hint: "Fastest" },
];

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
};

export type ContextPage = { id: string; title: string; icon?: string | null };

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
  /** Summarised reasoning, when the provider returns it. */
  thinking?: string;
  /** Steps a tool-using agent took (files read, searches, MCP tools), shown collapsed. */
  activity?: string[];
  /** Tool uses this chat's access mode didn't allow. */
  denied?: string[];
  provider?: ProviderId;
  model?: string;
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
  /** The folder "read" / "edit" work in. */
  folder?: string;
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
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  defaultProvider: null,
  anthropicKey: "",
  openaiKey: "",
  openaiModel: "",
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
};
