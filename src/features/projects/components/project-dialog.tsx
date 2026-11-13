"use client";

import { routes } from "@/lib/routes";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiPicker } from "@/components/emoji-picker";
import { IconTile } from "@/components/common";
import { COLOR_NAMES, COLORS, type ColorName } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useCreateProject } from "../hooks";

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { workspaceId } = useWorkspaceCtx();
  const router = useRouter();
  const create = useCreateProject(workspaceId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<ColorName>("indigo");
  const [targetDate, setTargetDate] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), description, icon, color, targetDate: targetDate || null },
      {
        onSuccess: (p) => {
          onOpenChange(false);
          setName("");
          setDescription("");
          setIcon(null);
          setTargetDate("");
          router.push(routes.project(p.id));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Projects group related tasks and track progress toward a goal.</DialogDescription>
          </DialogHeader>
          <div className="flex items-end gap-3">
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button type="button" aria-label="Choose icon" className="rounded-lg p-1 hover:bg-accent">
                  <IconTile icon={icon} name={name || "P"} color={color} className="size-10 text-xl" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <EmojiPicker onSelect={(e) => (setIcon(e), setEmojiOpen(false))} onRemove={icon ? () => (setIcon(null), setEmojiOpen(false)) : undefined} />
              </PopoverContent>
            </Popover>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Website relaunch" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-desc">Description</Label>
            <Textarea id="project-desc" value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} placeholder="What does done look like?" />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-target">Target date</Label>
              <Input id="project-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex h-8 items-center gap-1.5">
                {COLOR_NAMES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={COLORS[c].label}
                    aria-pressed={c === color}
                    onClick={() => setColor(c)}
                    className={cn("size-5 rounded-full ring-offset-2 ring-offset-background", c === color && "ring-2 ring-foreground/60")}
                    style={{ background: COLORS[c].hex }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
