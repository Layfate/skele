"use client";

import { useRouter } from "next/navigation";
import { routes } from "@/lib/routes";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiPicker } from "@/components/emoji-picker";
import { IconTile } from "@/components/common";
import { COLOR_NAMES, COLORS, type ColorName } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { useCreateWorkspace } from "../hooks";

export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const create = useCreateWorkspace();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<ColorName>("indigo");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), icon, color },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setIcon(null);
          router.push(routes.home);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>Each workspace keeps its own notes, projects, databases and attachments on this device.</DialogDescription>
          </DialogHeader>
          <div className="flex items-end gap-3">
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button type="button" aria-label="Choose icon" className="rounded-lg p-1 hover:bg-accent">
                  <IconTile icon={icon} name={name || "W"} color={color} className="size-10 text-xl" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <EmojiPicker
                  onSelect={(e) => {
                    setIcon(e);
                    setEmojiOpen(false);
                  }}
                  onRemove={icon ? () => (setIcon(null), setEmojiOpen(false)) : undefined}
                />
              </PopoverContent>
            </Popover>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input
                id="ws-name"
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_NAMES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={COLORS[c].label}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-6 rounded-full ring-offset-2 ring-offset-background transition",
                    c === color && "ring-2 ring-foreground/60",
                  )}
                  style={{ background: COLORS[c].hex }}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
