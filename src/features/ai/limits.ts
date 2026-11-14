// Respecting provider limits: reading Claude Code's and Codex's plan-limit reports, telling
// which errors mean "this provider can't answer right now" (so the local model can step in),
// and a small on-device ledger of tokens used per provider per day.

import { appMeta } from "@/data/registry";
import { isDesktop } from "@/lib/desktop";
import { codexUsage } from "./providers/cli";
import * as store from "./store";
import { PROVIDERS, type ProviderId, type TurnUsage, type UsageWindow } from "./types";

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** 0..1 → percent with one decimal (0.57 → 57). */
const toPercent = (fraction: number) => Math.round(fraction * 1000) / 10;

const CLAUDE_WINDOWS: Record<string, string> = {
  five_hour: "Current session (5 hours)",
  seven_day: "Weekly · all models",
  seven_day_opus: "Weekly · Opus",
  seven_day_sonnet: "Weekly · Sonnet",
};

const pretty = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Claude Code's rate_limit_event → windows (utilization is 0..1, resetsAt in seconds). */
export function claudeWindows(info: Json): UsageWindow[] {
  const unified = info.unifiedWindows as Record<string, Json> | undefined;
  if (unified && typeof unified === "object") {
    return Object.entries(unified)
      .filter(([, w]) => num(w?.utilization) !== undefined)
      .map(([key, w]) => ({ label: CLAUDE_WINDOWS[key] ?? pretty(key), usedPercent: toPercent(num(w.utilization)!), resetsAt: num(w.resetsAt) }));
  }
  const used = num(info.utilization);
  if (used === undefined) return [];
  const key = String(info.rateLimitType ?? "limit");
  return [{ label: CLAUDE_WINDOWS[key] ?? pretty(key), usedPercent: toPercent(used), resetsAt: num(info.resetsAt) }];
}

function windowLabel(minutes: number | undefined) {
  if (!minutes) return "Limit";
  if (minutes === 300) return "Current session (5 hours)";
  if (minutes === 10080) return "Weekly";
  return minutes % 1440 === 0 ? `${minutes / 1440}-day limit` : minutes % 60 === 0 ? `${minutes / 60}-hour limit` : `${minutes}-minute limit`;
}

/** Codex's rate_limits → windows (used_percent is 0..100, resets_at in seconds). */
export function codexWindows(limits: Json): UsageWindow[] {
  return ["primary", "secondary"]
    .map((k) => limits[k] as Json | null)
    .filter((w): w is Json => !!w && num(w.used_percent) !== undefined)
    .map((w) => ({ label: windowLabel(num(w.window_minutes)), usedPercent: num(w.used_percent)!, resetsAt: num(w.resets_at) }));
}

/** Where a provider stands against its plan limits, from its latest report. */
export type LimitState = {
  /** Over a limit that hasn't reset yet: requests will be refused. */
  blocked: boolean;
  /** The fullest window that hasn't reset. */
  usedPercent: number;
  label?: string;
  resetsAt?: number;
};

/** The fullest window that hasn't reset yet (windows past their reset time count as empty). */
export function limitState(windows: UsageWindow[], rejected = false, nowMs = Date.now()): LimitState | null {
  const live = windows.filter((w) => !w.resetsAt || w.resetsAt * 1000 > nowMs);
  if (!live.length) return null;
  const top = live.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
  return { blocked: rejected || top.usedPercent >= 100, usedPercent: top.usedPercent, label: top.label, resetsAt: top.resetsAt };
}

let codexCache: { at: number; value: LimitState | null } | null = null;

/** Latest limit reading for a CLI provider (API keys and local models have no plan limits). */
export async function providerLimit(provider: ProviderId): Promise<LimitState | null> {
  if (!isDesktop()) return null;
  if (provider === "claude-cli") {
    const saved = await store.getClaudeUsage();
    if (!saved) return null;
    const windows = claudeWindows(saved.info);
    const resetsAt = num(saved.info.resetsAt);
    const rejected = saved.info.status === "rejected" && (!resetsAt || resetsAt * 1000 > Date.now());
    return limitState(windows, rejected);
  }
  if (provider === "codex-cli") {
    if (codexCache && Date.now() - codexCache.at < 60_000) return codexCache.value;
    const latest = await codexUsage().catch(() => null);
    const value = latest ? limitState(codexWindows(latest.rateLimits)) : null;
    codexCache = { at: Date.now(), value };
    return value;
  }
  return null;
}

/** Forget the cached Codex reading (after a Codex reply, which records a new one). */
export const refreshCodexLimit = () => {
  codexCache = null;
};

export type ErrorKind = "limit" | "auth" | "missing" | "network" | "other";

/** What kind of failure an error message describes. */
export function classifyError(error: string): ErrorKind {
  const e = error.toLowerCase();
  if (/usage limit|rate.?limit|hit your limit|limit reached|quota|too many requests|\b429\b|credit balance|out of credits|overloaded/.test(e)) return "limit";
  if (/not logged in|log ?in|sign(ed)? ?in|authenticat|api key|unauthori[sz]ed|\b401\b|invalid.*key|expired/.test(e)) return "auth";
  if (/couldn't find the `|not installed|enoent|no such file|not recognized as/.test(e)) return "missing";
  if (/couldn't reach|couldn't connect|network|offline|enotfound|econnrefused|timed? ?out|dns|socket|fetch failed/.test(e)) return "network";
  return "other";
}

/** Errors where answering with the local model instead makes sense. */
export const canFallBack = (kind: ErrorKind) => kind !== "other";

export function fallbackReason(provider: ProviderId, kind: ErrorKind, limit?: LimitState | null) {
  const name = PROVIDERS[provider].label;
  if (limit?.blocked) {
    const when = limit.resetsAt ? ` until ${new Date(limit.resetsAt * 1000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "";
    return `${name} is at its usage limit${when}.`;
  }
  switch (kind) {
    case "limit":
      return `${name} is at its usage limit.`;
    case "auth":
      return `${name} isn't signed in.`;
    case "missing":
      return `${name} isn't installed.`;
    case "network":
      return `${name} couldn't be reached.`;
    default:
      return `${name} couldn't answer.`;
  }
}

// ── Usage ledger ────────────────────────────────────────────────────────────────────────

export type UsageBucket = { turns: number; input: number; output: number; cached: number; cost: number };
export type UsageLedger = { days: Record<string, Partial<Record<ProviderId, UsageBucket>>> };

const LEDGER_KEY = "ai:usage-ledger";
const KEEP_DAYS = 120;

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const getLedger = async (): Promise<UsageLedger> => (await appMeta.get<UsageLedger>(LEDGER_KEY)) ?? { days: {} };

export function addToLedger(ledger: UsageLedger, provider: ProviderId, usage: TurnUsage, day = dayKey()): UsageLedger {
  const days = { ...ledger.days };
  const today = { ...days[day] };
  const b = today[provider] ?? { turns: 0, input: 0, output: 0, cached: 0, cost: 0 };
  today[provider] = {
    turns: b.turns + 1,
    input: b.input + usage.inputTokens,
    output: b.output + usage.outputTokens,
    cached: b.cached + (usage.cachedTokens ?? 0),
    cost: b.cost + (usage.costUsd ?? 0),
  };
  days[day] = today;
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
  return { days };
}

export function recordUsage(provider: ProviderId, usage: TurnUsage) {
  return store.serial(async () => appMeta.set(LEDGER_KEY, addToLedger(await getLedger(), provider, usage)));
}

/** Totals per provider over the last `days` days (1 = today). */
export function ledgerTotals(ledger: UsageLedger, days: number, now = new Date()) {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  const first = dayKey(from);
  const totals: Partial<Record<ProviderId, UsageBucket>> = {};
  for (const [day, providers] of Object.entries(ledger.days)) {
    if (day < first) continue;
    for (const [p, b] of Object.entries(providers) as [ProviderId, UsageBucket][]) {
      const t = totals[p] ?? { turns: 0, input: 0, output: 0, cached: 0, cost: 0 };
      totals[p] = { turns: t.turns + b.turns, input: t.input + b.input, output: t.output + b.output, cached: t.cached + b.cached, cost: t.cost + b.cost };
    }
  }
  return totals;
}

export const clearLedger = () => store.serial(() => appMeta.delete(LEDGER_KEY));
