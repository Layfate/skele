"use client";

import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmojiPicker } from "@/components/emoji-picker";
import { workspaceStore } from "@/data/registry";
import { getRecord, saveRecordContent } from "@/data/repo/databases";
import { useEditorHost } from "@/features/pages/use-editor-host";
import { useAutosave } from "@/features/editor/use-autosave";
import { useUploader } from "@/features/files/hooks";
import { dbKeys, useRecord, type RecordDetail } from "../hooks";
import { useDb } from "./database-context";
import { PropertyCell } from "./property-cell";
import { AddPropertyMenu, PROPERTY_ICON } from "./property-header";

const SkeleEditor = dynamic(() => import("@/features/editor/editor").then((m) => m.SkeleEditor), { ssr: false });

export function RecordSheet({ recordId, onClose }: { recordId: string | null; onClose: () => void }) {
  const { workspaceId, data } = useDb();
  const record = useRecord(workspaceId, data.id, recordId);
  const missing = recordId && record.error;

  useEffect(() => {
    if (missing) {
      toast.error("That record no longer exists");
      onClose();
    }
  }, [missing, onClose]);

  return (
    <Sheet open={!!recordId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[720px]">
        <SheetTitle className="sr-only">Record</SheetTitle>
        <SheetDescription className="sr-only">Edit the record’s properties and notes</SheetDescription>
        {record.data && record.data.id === recordId ? (
          <RecordBody key={record.data.id} record={record.data} onClose={onClose} />
        ) : (
          <div className="space-y-4 p-10">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RecordBody({ record, onClose }: { record: RecordDetail; onClose: () => void }) {
  const { workspaceId, data, m, members, setValue, createOption, editable: dbEditable } = useDb();
  const qc = useQueryClient();
  const editable = dbEditable && record.canEdit;
  const live = data.records.find((r) => r.id === record.id);
  const values = live?.values ?? record.values;
  const [title, setTitle] = useState(live?.title ?? record.title);
  const [docKey, setDocKey] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upload = useUploader(workspaceId, data.pageId);
  const host = useEditorHost(workspaceId);

  const autosave = useAutosave({
    save: (doc, version) => saveRecordContent(workspaceStore(workspaceId), data.id, record.id, { doc, version }),
    initialVersion: record.version,
    onConflict: async () => {
      toast.info("This record was edited elsewhere — loaded the latest version.");
      const fresh = await qc.fetchQuery({
        queryKey: dbKeys.record(workspaceId, data.id, record.id),
        queryFn: () => getRecord(workspaceStore(workspaceId), data.id, record.id),
      });
      autosave.reset(fresh.version);
      setDocKey((k) => k + 1);
    },
    onSaved: (version) =>
      qc.setQueryData<RecordDetail>(dbKeys.record(workspaceId, data.id, record.id), (r) => (r ? { ...r, version } : r)),
  });

  const saveTitle = (next: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => m.updateRecord.mutate({ id: record.id, title: next }), 400);
  };
  const icon = live?.icon ?? record.icon;

  return (
    <div className="px-6 pt-12 pb-10 sm:px-12">
      <div className="absolute top-3 right-12 flex items-center gap-1">
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Record actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  m.deleteRecords.mutate([record.id]);
                  onClose();
                }}
              >
                <Trash2 /> Delete record
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
        <PopoverTrigger asChild disabled={!editable}>
          {icon ? (
            <button type="button" aria-label="Change icon" className="mb-1 rounded-lg p-1 text-5xl leading-none hover:bg-accent">
              {icon}
            </button>
          ) : (
            <Button variant="ghost" size="sm" className="mb-1 text-muted-foreground" hidden={!editable}>
              <SmilePlus /> Add icon
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <EmojiPicker
            onSelect={(e) => {
              m.updateRecord.mutate({ id: record.id, icon: e });
              setEmojiOpen(false);
            }}
            onRemove={
              icon
                ? () => {
                    m.updateRecord.mutate({ id: record.id, icon: null });
                    setEmojiOpen(false);
                  }
                : undefined
            }
          />
        </PopoverContent>
      </Popover>
      <textarea
        rows={1}
        value={title}
        readOnly={!editable}
        aria-label="Record name"
        placeholder="Untitled"
        maxLength={500}
        onChange={(e) => {
          const v = e.target.value.replace(/\n/g, "");
          setTitle(v);
          saveTitle(v);
        }}
        className="field-sizing-content w-full resize-none bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/40"
      />
      <dl className="mt-4 space-y-0.5">
        {data.properties.map((p) => {
          const Icon = PROPERTY_ICON[p.type];
          return (
            <div key={p.id} className="grid grid-cols-[160px_minmax(0,1fr)] items-start gap-2">
              <dt className="flex h-8 items-center gap-2 truncate text-sm text-muted-foreground">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{p.name}</span>
              </dt>
              <dd className="min-w-0">
                <PropertyCell
                  prop={p}
                  value={values[p.id]}
                  editable={editable}
                  members={members}
                  onChange={(v) => setValue(record.id, p.id, v)}
                  onCreateOption={(name) => createOption(p, name)}
                  placeholder="Empty"
                />
              </dd>
            </div>
          );
        })}
      </dl>
      {editable && (
        <AddPropertyMenu>
          <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground">
            <Plus /> Add a property
          </Button>
        </AddPropertyMenu>
      )}
      <hr className="my-5" />
      <SkeleEditor
        docKey={`${record.id}:${docKey}`}
        initialContent={qc.getQueryData<RecordDetail>(dbKeys.record(workspaceId, data.id, record.id))?.doc ?? record.doc}
        editable={editable}
        upload={upload}
        host={host}
        placeholder="Add notes, or type '/' for commands…"
        onUpdate={(doc) => {
          autosave.schedule(doc);
          qc.setQueryData<RecordDetail>(dbKeys.record(workspaceId, data.id, record.id), (r) => (r ? { ...r, doc } : r));
        }}
      />
    </div>
  );
}
