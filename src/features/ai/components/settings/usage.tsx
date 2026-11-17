"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { planUsage } from "../../commands";
import { aiKeys, useLedger } from "../../hooks";
import { clearLedger, ledgerTotals } from "../../limits";
import { PROVIDERS, type AiSettings, type ProviderId } from "../../types";
import { UsageCard } from "../messages";
import { ProviderIcon } from "../provider-menu";
import { Confirm, StatusLine } from "./shared";

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function UsageTab({ settings }: { settings: AiSettings }) {
  const desktop = isDesktop();
  const qc = useQueryClient();
  const showPlans = desktop || !!settings.openrouterKey;
  const plans = useQuery({ queryKey: ["ai-plan-usage", !!settings.openrouterKey], queryFn: () => planUsage(settings), enabled: showPlans, staleTime: 2 * 60_000, retry: false });
  const ledger = useLedger();
  const [range, setRange] = useState(7);
  const [clearing, setClearing] = useState(false);
  const totals = ledger.data ? ledgerTotals(ledger.data, range) : {};
  const rows = (Object.entries(totals) as [ProviderId, NonNullable<(typeof totals)[ProviderId]>][]).filter(([, b]) => b.turns > 0);

  return (
    <>
      {showPlans && (
        <SettingsCard
          title="Plan limits"
          description="How much of your Claude Code and Codex plans and your OpenRouter free requests are used. Skele warns you before a limit and, if you like, answers with the local model once one is reached."
        >
          {plans.isPending ? (
            <StatusLine tone="busy">Checking…</StatusLine>
          ) : plans.isError ? (
            <StatusLine tone="bad">{plans.error.message}</StatusLine>
          ) : (
            <UsageCard blocks={plans.data} />
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={plans.isFetching}
            onClick={() => {
              void plans.refetch();
              void qc.invalidateQueries({ queryKey: ["ai-limit"] });
            }}
          >
            <RefreshCw className={cn("size-3.5", plans.isFetching && "animate-spin")} /> Check again
          </Button>
        </SettingsCard>
      )}
      <SettingsCard title="Used in Skele" description="Tokens for replies in Skele's chats, as each provider reported them. Kept on this device for 120 days.">
        <div className="mb-3 inline-flex rounded-lg bg-muted p-[3px]" role="tablist" aria-label="Period">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="tab"
              aria-selected={r.days === range}
              onClick={() => setRange(r.days)}
              className={cn("h-7 rounded-md px-3 text-sm text-muted-foreground", r.days === range && "bg-background font-medium text-foreground shadow-sm")}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border scrollbar-thin">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 text-right font-medium">Replies</th>
                  <th className="px-3 py-2 text-right font-medium">In</th>
                  <th className="px-3 py-2 text-right font-medium">Out</th>
                  <th className="px-3 py-2 text-right font-medium" title="What it would cost at API prices (Claude Code reports it; plans include it)">
                    Est. cost
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map(([p, b]) => (
                  <tr key={p} className="border-t">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <ProviderIcon provider={p} className="size-5 [&_svg]:size-3" />
                        {PROVIDERS[p].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{b.turns}</td>
                    <td className="px-3 py-2 text-right" title={b.cached ? `${fmt(b.cached)} from cache` : undefined}>
                      {fmt(b.input)}
                    </td>
                    <td className="px-3 py-2 text-right">{fmt(b.output)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{b.cost ? `$${b.cost.toFixed(2)}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {settings.anthropicKey || settings.openaiKey || settings.openrouterKey ? (
          <p className="mt-3 text-xs text-muted-foreground">API keys are billed by their providers: see console.anthropic.com, platform.openai.com/usage and openrouter.ai/activity for exact costs.</p>
        ) : null}
        {ledger.data && Object.keys(ledger.data.days).length > 0 && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setClearing(true)}>
            Clear history
          </Button>
        )}
      </SettingsCard>
      <Confirm
        open={clearing}
        onOpenChange={setClearing}
        title="Clear usage history?"
        description="Skele forgets the token counts it recorded. Your chats and plan limits aren't affected."
        action="Clear"
        onConfirm={async () => {
          setClearing(false);
          await clearLedger();
          await qc.invalidateQueries({ queryKey: aiKeys.ledger });
        }}
      />
    </>
  );
}
