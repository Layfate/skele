"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, MoveVertical, SmilePlus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { EmojiPicker } from "@/components/emoji-picker";
import { isSafeUrl } from "@/features/editor/doc";
import { pickFile } from "@/features/editor/extensions/skele-storage";
import { cn } from "@/lib/utils";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useResolvedUrl } from "@/features/files/hooks";
import { COVER_PRESETS, coverStyle } from "../covers";
import type { UpdatePageInput } from "../schemas";

type HeaderPage = {
  title: string;
  icon: string | null;
  cover: string | null;
  coverPosition: number;
  kind: "DOCUMENT" | "DATABASE";
};

export function PageHeader({
  page,
  editable,
  onChange,
  onEnter,
  upload,
}: {
  page: HeaderPage;
  editable: boolean;
  onChange: (input: UpdatePageInput) => void;
  /** Called when the user presses Enter / ArrowDown at the end of the title. */
  onEnter?: () => void;
  upload: (file: File) => Promise<{ url: string }>;
}) {
  const [emojiOpen, setEmojiOpen] = useState(false);

  return (
    <div className="group/header">
      {page.cover && <Cover page={page} editable={editable} onChange={onChange} upload={upload} />}
      <div className={cn("mx-auto w-full", page.cover ? "-mt-9" : "pt-16")}>
        {page.icon && (
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild disabled={!editable}>
              <button
                type="button"
                aria-label="Change icon"
                className="relative mb-2 flex size-[72px] items-center justify-center rounded-xl text-[58px] leading-none transition-colors hover:bg-accent/70 disabled:hover:bg-transparent"
              >
                {page.icon}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <EmojiPicker
                onSelect={(icon) => {
                  onChange({ icon });
                  setEmojiOpen(false);
                }}
                onRemove={() => {
                  onChange({ icon: null });
                  setEmojiOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
        {editable && (
          <div className="flex h-8 items-center gap-1 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100">
            {!page.icon && (
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    <SmilePlus /> Add icon
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <EmojiPicker
                    onSelect={(icon) => {
                      onChange({ icon });
                      setEmojiOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            {!page.cover && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  const keys = Object.keys(COVER_PRESETS);
                  onChange({ cover: `preset:${keys[Math.floor(Math.random() * keys.length)]}`, coverPosition: 50 });
                }}
              >
                <ImageIcon /> Add cover
              </Button>
            )}
          </div>
        )}
        <TitleInput title={page.title} editable={editable} onChange={(title) => onChange({ title })} onEnter={onEnter} kind={page.kind} />
      </div>
    </div>
  );
}

function TitleInput({
  title,
  editable,
  onChange,
  onEnter,
  kind,
}: {
  title: string;
  editable: boolean;
  onChange: (t: string) => void;
  onEnter?: () => void;
  kind: "DOCUMENT" | "DATABASE";
}) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);

  // Accept remote changes (e.g. renamed from the sidebar) when not actively typing.
  useEffect(() => {
    if (!focused.current) setValue(title);
  }, [title]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const commit = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), 400);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      readOnly={!editable}
      maxLength={255}
      aria-label="Page title"
      placeholder={kind === "DATABASE" ? "Untitled database" : "Untitled"}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (timer.current) clearTimeout(timer.current);
        if (value !== title) onChange(value);
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, "");
        setValue(next);
        commit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === value.length)) {
          e.preventDefault();
          onEnter?.();
        }
      }}
      className="w-full resize-none overflow-hidden bg-transparent pt-1 pb-3 text-[2.4rem] leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/40"
    />
  );
}

function Cover({
  page,
  editable,
  onChange,
  upload,
}: {
  page: HeaderPage;
  editable: boolean;
  onChange: (input: UpdatePageInput) => void;
  upload: (file: File) => Promise<{ url: string }>;
}) {
  const cover = page.cover!;
  const [repositioning, setRepositioning] = useState(false);
  const [position, setPosition] = useState(page.coverPosition);
  const [uploading, setUploading] = useState(false);
  const drag = useRef<{ y: number; start: number } | null>(null);
  const isImage = !cover.startsWith("preset:") && isSafeUrl(cover);
  const { workspaceId } = useWorkspaceCtx();
  const coverUrl = useResolvedUrl(workspaceId, isImage ? cover : null);

  // Follow server changes to the saved position (adjusting state during render, not in an effect).
  const [savedPosition, setSavedPosition] = useState(page.coverPosition);
  if (savedPosition !== page.coverPosition) {
    setSavedPosition(page.coverPosition);
    setPosition(page.coverPosition);
  }

  const uploadCover = async () => {
    const file = await pickFile("image/png,image/jpeg,image/gif,image/webp");
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await upload(file);
      onChange({ cover: url, coverPosition: 50 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={cn("group/cover relative -mx-[var(--page-gutter)] h-[30vh] max-h-72 min-h-40 select-none", repositioning && "cursor-ns-resize")}
      style={!isImage ? coverStyle(cover) : undefined}
      onPointerDown={(e) => {
        if (!repositioning) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, start: position };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const delta = ((drag.current.y - e.clientY) / e.currentTarget.clientHeight) * 100;
        setPosition(Math.max(0, Math.min(100, Math.round(drag.current.start + delta))));
      }}
      onPointerUp={() => (drag.current = null)}
    >
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl ?? undefined} alt="" draggable={false} className="size-full object-cover" style={{ objectPosition: `center ${position}%` }} />
      )}
      {editable && (
        <div
          className={cn(
            "absolute right-[var(--page-gutter)] bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100",
            repositioning && "opacity-100",
          )}
        >
          {repositioning ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => (setRepositioning(false), setPosition(page.coverPosition))}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onChange({ coverPosition: position });
                  setRepositioning(false);
                }}
              >
                Save position
              </Button>
            </>
          ) : (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="secondary" className="shadow-sm">
                    Change cover
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Gradients</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Object.entries(COVER_PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        type="button"
                        title={preset.label}
                        aria-label={preset.label}
                        onClick={() => onChange({ cover: `preset:${key}`, coverPosition: 50 })}
                        className={cn("h-12 rounded-md border", cover === `preset:${key}` && "ring-2 ring-ring")}
                        style={{ background: preset.css }}
                      />
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="mt-3 w-full" onClick={uploadCover} disabled={uploading}>
                    {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                    Upload an image
                  </Button>
                </PopoverContent>
              </Popover>
              {isImage && (
                <Button size="sm" variant="secondary" className="shadow-sm" onClick={() => setRepositioning(true)}>
                  <MoveVertical /> Reposition
                </Button>
              )}
              <Button size="icon-sm" variant="secondary" className="shadow-sm" aria-label="Remove cover" onClick={() => onChange({ cover: null })}>
                <X />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
