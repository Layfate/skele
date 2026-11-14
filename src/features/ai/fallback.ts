// One reply with the local fallback: when the chosen provider is known to be over its plan
// limit, or fails because it's at a limit, signed out, offline or not installed, the local
// model (Ollama) answers instead, and the reply says so.

import { errorMessage } from "@/lib/errors";
import { canFallBack, classifyError, fallbackReason, providerLimit } from "./limits";
import { resolveTarget, runTurn, type TurnInput } from "./run";
import { isCli, type ChatMessage, type ProviderId } from "./types";

export type TurnOutcome = Awaited<ReturnType<typeof runTurn>>;

export async function runWithFallback(
  input: TurnInput,
  /** Called when the reply switches to the local model, before it starts. */
  onSwitch: (local: { provider: ProviderId; model: string }, reason: string) => void,
): Promise<{ result: TurnOutcome; fallback?: ChatMessage["fallback"] }> {
  const { chat, settings, agent } = input;
  const target = resolveTarget(chat, settings, agent);
  const local = { provider: "ollama" as const, model: settings.ollamaModel };
  const canLocal = settings.localFallback && !!settings.ollamaModel && target.provider !== "ollama";
  const attempt = (override?: typeof local) =>
    runTurn({ ...input, override }).catch((e): TurnOutcome => ({ text: "", error: errorMessage(e), ...(override ?? target) }));

  // Known to be over its plan limit: don't spend a request, go local right away.
  if (canLocal && isCli(target.provider)) {
    const limit = await providerLimit(target.provider).catch(() => null);
    if (limit?.blocked) {
      const reason = fallbackReason(target.provider, "limit", limit);
      onSwitch(local, reason);
      return { result: await attempt(local), fallback: { from: target.provider, reason } };
    }
  }
  const result = await attempt();
  if (!canLocal || !result.error || result.stopped || result.text.trim()) return { result };
  const kind = classifyError(result.error);
  if (!canFallBack(kind)) return { result };
  const reason = fallbackReason(result.provider, kind);
  onSwitch(local, reason);
  return { result: await attempt(local), fallback: { from: result.provider, reason } };
}
