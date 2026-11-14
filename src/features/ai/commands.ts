// Slash commands Skele answers itself (they're never sent to a model). Claude Code's own
// /usage and /status only exist in its terminal UI, so Skele reads the same information.
// Any other "/name" is a skill and goes to Claude Code / Codex.

import { isDesktop } from "@/lib/desktop";
import { listSkills } from "./extensions";
import { claudeWindows, codexWindows, getLedger, ledgerTotals } from "./limits";
import { cliAuth, cliStatus, codexModels, codexUsage, runCli } from "./providers/cli";
import { listOllamaModels, ollamaStatus } from "./providers/ollama";
import { noHandlers } from "./providers/types";
import * as store from "./store";
import { providerAvailable, SKELE_COMMANDS } from "./run";
import {
  ANTHROPIC_MODELS,
  CLAUDE_CLI_MODELS,
  isCli,
  PROVIDERS,
  type Agent,
  type AccessMode,
  type AiSettings,
  type Chat,
  type InfoCard,
  type McpServer,
  type ModelOption,
  type ProviderId,
  type UsageBlock,
} from "./types";

export type SlashCommand = { name: string; description: string; args?: string };

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "usage", description: "Plan limits and tokens used" },
  { name: "status", description: "Accounts, versions and this chat's setup" },
  { name: "compact", description: "Summarize the chat so far to save context" },
  { name: "model", description: "Show or switch this chat's model", args: "[model]" },
  { name: "mode", description: "What the AI may do: chat, read or edit files", args: "[chat|read|edit]" },
  { name: "mcp", description: "MCP servers for this chat" },
  { name: "skills", description: "Installed skills (type /name to use one)" },
  { name: "agents", description: "Your agents (type @name to ask one)" },
  { name: "new", description: "Start a new chat" },
  { name: "help", description: "What you can do here" },
];

/** A Skele command in a message ("/model sonnet" → { name: "model", args: "sonnet" }), or null. */
export function parseCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  const name = m?.[1].toLowerCase();
  return name && SKELE_COMMANDS.has(name) ? { name, args: (m![2] ?? "").trim() } : null;
}

type Json = Record<string, unknown>;
const CLAUDE_FRESH_MS = 2 * 60_000;
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (n: number) => `${Math.round(n)}%`;
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

async function claudeUsage(settings: AiSettings): Promise<UsageBlock> {
  const block: UsageBlock = { tool: "Claude Code", windows: [] };
  try {
    const auth = await cliAuth("claude", settings.claudePath);
    const info = JSON.parse(auth.output) as Json;
    if (info.loggedIn === false) return { ...block, note: "Not signed in. Run `claude` in a terminal and sign in." };
    const plan = info.subscriptionType ?? info.planTier;
    if (typeof plan === "string") block.plan = titleCase(plan);
    else if (info.authMethod && info.authMethod !== "claude.ai") block.plan = "API key";
  } catch {
    // Older versions without `auth status --json`: carry on without the plan name.
  }
  let saved = await store.getClaudeUsage();
  if (!saved || Date.now() - new Date(saved.at).getTime() > CLAUDE_FRESH_MS) {
    // Claude Code reports limits with each reply; ask a tiny question to get a fresh reading.
    const result = await runCli({
      tool: "claude",
      prompt: "Reply with the single word: ok",
      model: "haiku",
      effort: "low",
      systemPrompt: "Reply with one word.",
      path: settings.claudePath,
      ephemeral: true,
      signal: new AbortController().signal,
      on: noHandlers,
    });
    if (result.rateLimit) {
      await store.saveClaudeUsage(result.rateLimit);
      saved = await store.getClaudeUsage();
    } else if (result.error && !saved) {
      return { ...block, note: result.error };
    }
  }
  if (!saved) return { ...block, note: "Claude Code didn't report any limits. Usage-based (API key) accounts have no plan limits." };
  return { ...block, windows: claudeWindows(saved.info), asOf: saved.at };
}

async function codexBlock(): Promise<UsageBlock> {
  const block: UsageBlock = { tool: "Codex", windows: [] };
  const latest = await codexUsage().catch(() => null);
  if (!latest) return { ...block, note: "No usage recorded yet. It appears after your first Codex reply." };
  const plan = latest.rateLimits.plan_type;
  return {
    ...block,
    plan: typeof plan === "string" ? titleCase(plan) : undefined,
    windows: codexWindows(latest.rateLimits),
    asOf: latest.timestamp,
    note: "Updated after each Codex reply.",
  };
}

/** Claude Code's and Codex's plan limits (desktop app). May ask Claude Code a one-word question for a fresh reading. */
export async function planUsage(settings: AiSettings): Promise<UsageBlock[]> {
  if (!isDesktop()) return [];
  return Promise.all([claudeUsage(settings), codexBlock()]);
}

function usageText(blocks: UsageBlock[], extra: string[]) {
  const lines: string[] = [];
  for (const b of blocks) {
    lines.push(`**${b.tool}**${b.plan ? ` (${b.plan})` : ""}`);
    for (const w of b.windows) {
      const reset = w.resetsAt ? `, resets ${new Date(w.resetsAt * 1000).toLocaleString()}` : "";
      lines.push(`- ${w.label}: ${pct(w.usedPercent)} used${reset}`);
    }
    if (b.note) lines.push(`- ${b.note}`);
    lines.push("");
  }
  return [...lines, ...extra].join("\n").trim();
}

/** Models a provider offers, for /model and the model menu. */
export async function modelsFor(provider: ProviderId, settings: AiSettings): Promise<ModelOption[]> {
  switch (provider) {
    case "claude-cli":
      return CLAUDE_CLI_MODELS;
    case "codex-cli":
      return [{ id: "", label: "Default", hint: "Codex's configured model" }, ...(await codexModels().catch(() => []))];
    case "anthropic":
      return ANTHROPIC_MODELS;
    case "ollama":
      return (await listOllamaModels(settings.ollamaUrl).catch(() => [])).map((m) => ({ id: m.name, label: m.name, hint: m.details?.parameter_size }));
    case "openai":
      return settings.openaiModel ? [{ id: settings.openaiModel, label: settings.openaiModel }] : [];
  }
}

export type CommandContext = { mcp: McpServer[]; agents: Agent[] };

export type CommandResult = {
  content: string;
  card?: InfoCard;
  /** Changes to apply to the chat (/model, /mode). */
  patch?: Partial<Pick<Chat, "model" | "mode">>;
  /** Run /compact (summarize) after showing `content`. */
  compact?: boolean;
};

const MODES: Record<AccessMode, string> = {
  chat: "**Chat**: no access to your files",
  read: "**Read files**: can read files in the chat's folder",
  edit: "**Edit files**: can read and change files in the chat's folder",
};

export async function runCommand(name: string, args: string, chat: Chat, settings: AiSettings, ctx: CommandContext): Promise<CommandResult> {
  const desktop = isDesktop();
  const cli = isCli(chat.provider);

  if (name === "help") {
    return {
      content: [
        "**Things you can do here**",
        "- Ask anything, or attach pages with **Pages** so the AI can read them.",
        "- Switch between Claude, Codex and local models at any time from the message box; the new one sees the conversation so far.",
        "- **Quick / Balanced / Thorough** sets how long the model thinks.",
        desktop ? "- The **shield** button sets what Claude Code and Codex may do: just chat, read files in a folder, or edit them. MCP servers and web search are turned on there too." : "",
        "- Type **@** to ask one of your agents (several at once if you like); they answer side by side.",
        desktop ? "- Type **/** and a skill's name to use a skill." : "",
        "- Hover a reply to copy it, try again, or save it as a page. Hover your own message to edit it.",
        "",
        "**Commands**",
        ...SLASH_COMMANDS.map((c) => `- \`/${c.name}${c.args ? ` ${c.args}` : ""}\`: ${c.description}`),
      ]
        .filter((l) => l !== "")
        .join("\n"),
    };
  }

  if (name === "compact") {
    return { content: "Summarizing the conversation so far…", compact: true };
  }

  if (name === "model") {
    const options = await modelsFor(chat.provider, settings);
    if (!args) {
      const current = options.find((m) => m.id === chat.model)?.label ?? (chat.model || "Default");
      return {
        content: [
          `**${PROVIDERS[chat.provider].label}** · ${current}`,
          "",
          options.length ? "Available:" : "",
          ...options.slice(0, 25).map((m) => `- \`${m.id || "default"}\`${m.label !== m.id ? ` ${m.label}` : ""}${m.hint ? `: ${m.hint}` : ""}`),
          "",
          "Switch with `/model <name>`.",
        ].join("\n"),
      };
    }
    const wanted = args === "default" ? "" : args;
    if (!/^[A-Za-z0-9._:\-/[\]@]{0,120}$/.test(wanted)) return { content: `“${args}” isn't a valid model name.` };
    const known = options.find((m) => m.id.toLowerCase() === wanted.toLowerCase() || m.label.toLowerCase() === wanted.toLowerCase());
    const model = known?.id ?? wanted;
    return {
      content: `Switched to **${known?.label ?? (model || "Default")}**${known || !options.length ? "" : " (not in the known list; it will be tried as-is)"}.`,
      patch: { model },
    };
  }

  if (name === "mode") {
    const current = chat.mode ?? "chat";
    if (!cli) return { content: `${PROVIDERS[chat.provider].label} can only chat. File access is for Claude Code and Codex in the desktop app.` };
    if (!args) {
      return {
        content: [
          `Now: ${MODES[current]}${chat.folder && current !== "chat" ? ` (\`${chat.folder}\`)` : ""}.`,
          "",
          ...Object.values(MODES).map((m) => `- ${m}`),
          "",
          "Switch with `/mode chat`, `/mode read` or `/mode edit`, or with the shield button.",
        ].join("\n"),
      };
    }
    const mode = args.toLowerCase() as AccessMode;
    if (!(mode in MODES)) return { content: "Use `/mode chat`, `/mode read` or `/mode edit`." };
    if (mode !== "chat" && !chat.folder) return { content: "Choose a folder first, with the shield button below the message box." };
    return { content: `Now: ${MODES[mode]}${mode !== "chat" ? ` (\`${chat.folder}\`)` : ""}.`, patch: { mode } };
  }

  if (name === "mcp") {
    if (!desktop) return { content: "MCP servers are available in the Skele desktop app." };
    if (!ctx.mcp.length) return { content: "No MCP servers yet. Add some in **Settings → AI → MCP servers**." };
    const on = new Set(chat.mcp ?? []);
    return {
      content: [
        `**MCP servers**${cli ? "" : ` (only Claude Code and Codex can use them; this chat uses ${PROVIDERS[chat.provider].label})`}`,
        ...ctx.mcp.map((s) => `- ${on.has(s.id) && s.enabled ? "✓" : "○"} **${s.name}** ${s.transport === "stdio" ? `\`${[s.command, ...s.args].join(" ")}\`` : s.url}${s.enabled ? "" : " (turned off in settings)"}`),
        "",
        "Turn servers on or off for this chat with the shield button.",
        settings.useCliExtensions ? "Servers set up in Claude Code and Codex themselves are also used." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (name === "skills") {
    if (!desktop) return { content: "Skills are available in the Skele desktop app." };
    const skills = await listSkills().catch(() => []);
    if (!skills.length) return { content: "No skills installed. Create or import one in **Settings → AI → Skills**." };
    const lines: string[] = [];
    for (const tool of ["claude", "codex"] as const) {
      const list = skills.filter((s) => s.tool === tool);
      if (!list.length) continue;
      lines.push(`**${tool === "claude" ? "Claude Code" : "Codex"}**`);
      lines.push(...list.map((s) => `- \`/${s.name}\`${s.description ? `: ${s.description}` : ""}`));
      lines.push("");
    }
    lines.push("Type `/` and a skill's name, followed by what you want, to use it.");
    return { content: lines.join("\n") };
  }

  if (name === "agents") {
    if (!ctx.agents.length) return { content: "No agents yet. Create some in **Settings → AI → Agents**, then type `@name` to ask one." };
    return {
      content: [
        "**Your agents**",
        ...ctx.agents.map(
          (a) => `- **@${a.name}**${a.description ? `: ${a.description}` : ""}${a.provider ? ` · ${PROVIDERS[a.provider].label}${a.model ? ` ${a.model}` : ""}` : ""}${a.subagent ? " · sub-agent" : ""}`,
        ),
        "",
        "Type `@name` to ask one, or several (`@reviewer @editor …`) to get replies side by side.",
      ].join("\n"),
    };
  }

  if (name === "usage") {
    const blocks: UsageBlock[] = [];
    const extra: string[] = [];
    if (desktop) {
      blocks.push(...(await planUsage(settings)));
    }
    const week = ledgerTotals(await getLedger(), 7);
    const used = (Object.entries(week) as [ProviderId, NonNullable<(typeof week)[ProviderId]>][]).filter(([, b]) => b.turns);
    if (used.length) {
      extra.push(
        `**Last 7 days in Skele:** ${used
          .map(([p, b]) => `${PROVIDERS[p].label} ${b.turns} replies, ${fmt(b.input)} in / ${fmt(b.output)} out${b.cost ? ` (≈ $${b.cost.toFixed(2)} at API prices)` : ""}`)
          .join(" · ")}`,
      );
    }
    if (settings.anthropicKey) extra.push("Claude API (your key) is billed per token: see console.anthropic.com → Usage.");
    if (settings.openaiKey) extra.push("OpenAI API (your key) is billed per token: see platform.openai.com/usage.");
    if (settings.ollamaModel) extra.push("Local models (Ollama) have no usage limits.");
    if (!desktop && !extra.length) extra.push("Plan limits for Claude Code and Codex are shown in the Skele desktop app.");
    return { content: usageText(blocks, extra), card: blocks.length ? { kind: "usage", blocks, notes: extra } : undefined };
  }

  // status
  const mode = chat.mode ?? "chat";
  const lines = [
    `**This chat:** ${PROVIDERS[chat.provider].label}${chat.model ? ` · ${chat.model}` : " · default model"} · ${chat.effort} thinking`,
    cli ? `**Access:** ${MODES[mode].replace(/\*\*/g, "")}${mode !== "chat" && chat.folder ? ` (\`${chat.folder}\`)` : ""}${chat.web ? " · web search on" : ""}` : "",
    cli && chat.mcp?.length
      ? `**MCP servers:** ${ctx.mcp
          .filter((s) => chat.mcp!.includes(s.id) && s.enabled)
          .map((s) => s.name)
          .join(", ") || "none"}`
      : "",
    chat.agentId ? `**Agent:** @${ctx.agents.find((a) => a.id === chat.agentId)?.name ?? "(deleted)"}` : "",
  ].filter(Boolean);
  if (desktop) {
    const statuses = await cliStatus({ claude: settings.claudePath, codex: settings.codexPath, ollama: settings.ollamaPath }).catch(() => []);
    for (const tool of ["claude", "codex"] as const) {
      const st = statuses.find((s) => s.tool === tool);
      const label = tool === "claude" ? "Claude Code" : "Codex";
      if (!st?.path) {
        lines.push(`**${label}:** not installed`);
        continue;
      }
      let account = "";
      try {
        const auth = await cliAuth(tool, tool === "claude" ? settings.claudePath : settings.codexPath);
        if (tool === "claude") {
          const info = JSON.parse(auth.output) as Json;
          account = info.loggedIn
            ? `signed in${info.email ? ` as ${info.email}` : ""}${info.subscriptionType ? ` (${titleCase(String(info.subscriptionType))})` : ""}`
            : "not signed in";
        } else {
          account = auth.ok ? auth.output.split("\n")[0].replace(/^Logged in using/i, "signed in with") : "not signed in";
        }
      } catch {
        account = "sign-in status unknown";
      }
      lines.push(`**${label}:** ${st.version ?? "installed"} · ${account}`);
    }
  }
  const ollama = await ollamaStatus(settings.ollamaUrl, settings.ollamaPath).catch(() => null);
  lines.push(
    `**Ollama:** ${ollama?.running ? `running (${ollama.version})${settings.ollamaModel ? ` · ${settings.ollamaModel}` : " · no model chosen"}` : ollama?.binary ? "installed, not running" : "not found"}${settings.localFallback && settings.ollamaModel ? " · used as fallback" : ""}`,
  );
  lines.push(`**Claude API key:** ${settings.anthropicKey ? `set (…${settings.anthropicKey.slice(-4)})` : "not set"}`);
  lines.push(`**OpenAI API key:** ${settings.openaiKey ? `set (…${settings.openaiKey.slice(-4)})` : "not set"}`);
  const available = (Object.keys(PROVIDERS) as ProviderId[]).filter((p) => providerAvailable(p, settings));
  lines.push(`**Available here:** ${available.map((p) => PROVIDERS[p].label).join(", ") || "none"}`);
  return { content: lines.map((l) => `- ${l}`).join("\n") };
}
