"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AtSign, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { AGENT_TEMPLATES, deleteAgent, saveAgent, validateAgent } from "../../agents";
import { aiKeys, useAgents } from "../../hooks";
import { providerAvailable } from "../../run";
import { PROVIDERS, PROVIDER_IDS, type Agent, type AiSettings, type ProviderId } from "../../types";
import { ProviderIcon } from "../provider-menu";
import { Confirm, StatusLine } from "./shared";

type Draft = Omit<Agent, "id" | "createdAt" | "updatedAt"> & { id?: string };

const blank = (): Draft => ({ name: "", description: "", instructions: "", provider: null, model: "", subagent: false });

export function AgentsTab({ settings }: { settings: AiSettings }) {
  const agents = useAgents();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<Agent | null>(null);
  const list = agents.data ?? [];
  const unusedTemplates = AGENT_TEMPLATES.filter((t) => !list.some((a) => a.name === t.name));

  return (
    <>
      <SettingsCard
        title="Agents"
        description="Assistants with their own instructions, and optionally their own provider and model. Type @name in a chat to ask one (or several, side by side), or make one a chat's default from the @ button."
      >
        {agents.isPending ? (
          <StatusLine tone="busy">Loading…</StatusLine>
        ) : list.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">No agents yet. Start from one of these, or create your own.</p>
        ) : (
          <div className="mb-4 divide-y rounded-lg border">
            {list.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                {a.provider ? (
                  <ProviderIcon provider={a.provider} className="size-7 rounded-lg [&_svg]:size-3.5" />
                ) : (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <AtSign className="size-3.5" />
                  </span>
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    @{a.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {a.provider ? `${PROVIDERS[a.provider].label}${a.model ? ` · ${a.model}` : ""}` : "Uses the chat's model"}
                      {a.subagent ? " · sub-agent" : ""}
                    </span>
                  </p>
                  {a.description && <p className="truncate text-xs text-muted-foreground">{a.description}</p>}
                </div>
                <button
                  type="button"
                  aria-label={`Edit ${a.name}`}
                  onClick={() => setEditing({ ...a })}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${a.name}`}
                  onClick={() => setToDelete(a)}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing(blank())}>
            <Plus className="size-3.5" /> New agent
          </Button>
          {unusedTemplates.map((t) => (
            <Button key={t.name} variant="outline" size="sm" onClick={() => setEditing({ ...blank(), ...t })}>
              @{t.name}
            </Button>
          ))}
        </div>
      </SettingsCard>
      {editing && (
        <AgentDialog
          draft={editing}
          others={list}
          settings={settings}
          onClose={() => setEditing(null)}
          onSaved={async (a) => {
            setEditing(null);
            toast.success(`Saved @${a.name}`);
            await qc.invalidateQueries({ queryKey: aiKeys.agents });
          }}
        />
      )}
      <Confirm
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete @${toDelete?.name}?`}
        description="Replies it already gave stay in your chats."
        action="Delete"
        onConfirm={async () => {
          const id = toDelete!.id;
          setToDelete(null);
          await deleteAgent(id).catch((e) => toast.error(errorMessage(e)));
          await qc.invalidateQueries({ queryKey: aiKeys.agents });
        }}
      />
    </>
  );
}

function AgentDialog({
  draft,
  others,
  settings,
  onClose,
  onSaved,
}: {
  draft: Draft;
  others: Agent[];
  settings: AiSettings;
  onClose: () => void;
  onSaved: (a: Agent) => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const error = validateAgent(d, others, d.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{draft.id ? `Edit @${draft.name}` : "New agent"}</DialogTitle>
          <DialogDescription>Mention it with @{d.name || "name"} in any chat.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input id="agent-name" value={d.name} spellCheck={false} placeholder="reviewer" onChange={(e) => setD({ ...d, name: e.target.value.replace(/\s+/g, "-") })} />
            </div>
            <div className="space-y-1.5">
              <Label>Answers with</Label>
              <Select value={d.provider ?? "chat"} onValueChange={(v) => setD({ ...d, provider: v === "chat" ? null : (v as ProviderId), model: "" })}>
                <SelectTrigger aria-label="Answers with">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">The chat&apos;s provider</SelectItem>
                  {PROVIDER_IDS.filter((p) => providerAvailable(p, settings) || p === d.provider).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDERS[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {d.provider && (
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">Model (optional)</Label>
              <Input
                id="agent-model"
                value={d.model}
                spellCheck={false}
                placeholder={d.provider === "claude-cli" ? "sonnet, opus, haiku…" : d.provider === "ollama" ? settings.ollamaModel || "llama3.2" : "The provider's default"}
                onChange={(e) => setD({ ...d, model: e.target.value.trim() })}
                className="font-mono text-xs"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="agent-desc">Description</Label>
            <Input id="agent-desc" value={d.description} maxLength={300} placeholder="What it's good at" onChange={(e) => setD({ ...d, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              value={d.instructions}
              rows={6}
              maxLength={8000}
              placeholder="You are a careful reviewer. Point out…"
              onChange={(e) => setD({ ...d, instructions: e.target.value })}
            />
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="block">Claude Code can delegate to it</span>
              <span className="block text-xs text-muted-foreground">Offered to Claude Code as a sub-agent it can hand parts of a task to, in any chat.</span>
            </span>
            <Switch checked={d.subagent} onCheckedChange={(subagent) => setD({ ...d, subagent })} />
          </label>
        </div>
        <DialogFooter className="items-center">
          {error && (d.name || d.instructions) && <p className="mr-auto text-xs text-muted-foreground">{error}</p>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!!error || busy}
            onClick={async () => {
              setBusy(true);
              try {
                onSaved(await saveAgent(d));
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
