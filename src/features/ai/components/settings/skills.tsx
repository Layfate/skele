"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FolderInput, Link2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { isDesktop } from "@/lib/desktop";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { deleteSkill, importSkill, readSkill, SKILL_NAME, skillMarkdown, writeSkill, type Skill } from "../../extensions";
import { aiKeys, useSkills } from "../../hooks";
import type { CliTool } from "../../providers/cli";
import { Confirm, DesktopOnly, StatusLine } from "./shared";

const LABEL: Record<CliTool, string> = { claude: "Claude Code", codex: "Codex" };

export function SkillsTab() {
  const skills = useSkills();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ skill: Skill; text: string } | null>(null);
  const [toDelete, setToDelete] = useState<Skill | null>(null);
  if (!isDesktop()) return <DesktopOnly what="Skills" />;
  const refresh = () => qc.invalidateQueries({ queryKey: aiKeys.skills });

  const open = async (skill: Skill) => {
    try {
      setEditing({ skill, text: await readSkill(skill.tool, skill.name) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doImport = async (tool: CliTool) => {
    try {
      const name = await importSkill(tool);
      if (name) {
        toast.success(`Imported ${name} into ${LABEL[tool]}`);
        await refresh();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <SettingsCard
        title="Skills"
        description="Skills are folders of instructions (and optional scripts) that Claude Code and Codex load when a task calls for them. Use one in a chat by typing / and its name."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New skill
          </Button>
          <Button variant="outline" size="sm" onClick={() => void doImport("claude")}>
            <FolderInput className="size-3.5" /> Import into Claude Code
          </Button>
          <Button variant="outline" size="sm" onClick={() => void doImport("codex")}>
            <FolderInput className="size-3.5" /> Import into Codex
          </Button>
        </div>
        {skills.isPending ? (
          <StatusLine tone="busy">Loading skills…</StatusLine>
        ) : skills.isError ? (
          <StatusLine tone="bad">{skills.error.message}</StatusLine>
        ) : (
          (["claude", "codex"] as const).map((tool) => {
            const list = skills.data.filter((s) => s.tool === tool);
            return (
              <div key={tool} className="mb-4 last:mb-0">
                <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{LABEL[tool]}</p>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No skills.</p>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {list.map((s) => (
                      <div key={s.path} className="flex items-center gap-3 px-3 py-2.5">
                        <Sparkles className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="flex items-center gap-1.5 font-mono font-medium">
                            /{s.name}
                            {s.linked && <Link2 className="size-3 text-muted-foreground" aria-label="Linked folder" />}
                          </p>
                          {s.description && <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                        </div>
                        <button
                          type="button"
                          aria-label={`Edit ${s.name}`}
                          onClick={() => void open(s)}
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        {!s.linked && (
                          <button
                            type="button"
                            aria-label={`Delete ${s.name}`}
                            onClick={() => setToDelete(s)}
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </SettingsCard>

      {creating && (
        <NewSkillDialog
          existing={skills.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={async (tool, name) => {
            setCreating(false);
            toast.success(`Created /${name} in ${LABEL[tool]}`);
            await refresh();
          }}
        />
      )}
      {editing && (
        <EditSkillDialog
          skill={editing.skill}
          initial={editing.text}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            toast.success("Skill saved");
            await refresh();
          }}
        />
      )}
      <Confirm
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete /${toDelete?.name}?`}
        description={
          <>
            Its whole folder is deleted from {toDelete ? LABEL[toDelete.tool] : ""}:
            <br />
            <code className="font-mono text-xs break-all">{toDelete?.path}</code>
          </>
        }
        action="Delete"
        onConfirm={async () => {
          const s = toDelete!;
          setToDelete(null);
          try {
            await deleteSkill(s.tool, s.name);
            await refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}

function NewSkillDialog({ existing, onClose, onCreated }: { existing: Skill[]; onClose: () => void; onCreated: (tool: CliTool, name: string) => void }) {
  const [tool, setTool] = useState<CliTool | "both">("claude");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const tools: CliTool[] = tool === "both" ? ["claude", "codex"] : [tool];
  const error = !SKILL_NAME.test(name)
    ? "Name: lowercase letters, digits and hyphens."
    : tools.some((t) => existing.some((s) => s.tool === t && s.name === name))
      ? "A skill with this name already exists there."
      : !description.trim()
        ? "Describe what it does and when to use it."
        : !body.trim()
          ? "Write the instructions."
          : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>The AI reads the description to decide when to use the skill, and follows the instructions when it does.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <div className="space-y-1.5">
              <Label htmlFor="skill-name">Name</Label>
              <Input
                id="skill-name"
                value={name}
                spellCheck={false}
                placeholder="meeting-notes"
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s_]+/g, "-"))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>For</Label>
              <Select value={tool} onValueChange={(v) => setTool(v as CliTool | "both")}>
                <SelectTrigger aria-label="For">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude Code</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-desc">Description</Label>
            <Input
              id="skill-desc"
              value={description}
              maxLength={1024}
              placeholder="Turns rough meeting notes into a summary with decisions and action items. Use when the user shares meeting notes."
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-body">Instructions</Label>
            <Textarea
              id="skill-body"
              value={body}
              rows={9}
              placeholder={"# Meeting notes\n\n1. List the decisions made.\n2. List action items with owners and dates.\n3. …"}
              onChange={(e) => setBody(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter className="items-center">
          {error && (name || description || body) && <p className="mr-auto text-xs text-muted-foreground">{error}</p>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!!error || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const md = skillMarkdown(name, description, body);
                for (const t of tools) await writeSkill(t, name, md);
                onCreated(tools[0], name);
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditSkillDialog({ skill, initial, onClose, onSaved }: { skill: Skill; initial: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono">/{skill.name}</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{skill.path}</DialogDescription>
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} spellCheck={false} className="font-mono text-xs" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || text === initial}
            onClick={async () => {
              setBusy(true);
              try {
                await writeSkill(skill.tool, skill.name, text);
                onSaved();
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
