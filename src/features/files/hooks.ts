"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { workspaceStore } from "@/data/registry";
import * as repo from "@/data/repo/files";
import { FILE_SCHEME } from "@/features/editor/doc";

export type FileList = Awaited<ReturnType<typeof repo.listFiles>>;

/** Stable uploader bound to a workspace/page, for the editor and cover picker. */
export function useUploader(workspaceId: string, pageId?: string | null) {
  const qc = useQueryClient();
  return useCallback(
    async (file: File) => {
      const result = await repo.uploadFile(workspaceStore(workspaceId), file, pageId ?? null);
      qc.invalidateQueries({ queryKey: ["files", workspaceId] });
      return result;
    },
    [workspaceId, pageId, qc],
  );
}

export function useFiles(workspaceId: string) {
  return useQuery({ queryKey: ["files", workspaceId], queryFn: () => repo.listFiles(workspaceStore(workspaceId)) });
}

export function useDeleteFile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => repo.deleteFile(workspaceStore(workspaceId), fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files", workspaceId] });
      toast.success("File deleted");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Resolves `skele-file:<id>` references to a displayable blob URL (other URLs pass through). */
export function useResolvedUrl(workspaceId: string | null, src: string | null | undefined) {
  const [resolved, setResolved] = useState<{ src: string; url: string | null } | null>(null);
  const isLocal = !!src && src.startsWith(FILE_SCHEME);
  useEffect(() => {
    if (!src || !isLocal || !workspaceId) return;
    let cancelled = false;
    repo
      .fileObjectUrl(workspaceStore(workspaceId), src.slice(FILE_SCHEME.length))
      .then((url) => !cancelled && setResolved({ src, url }))
      .catch(() => !cancelled && setResolved({ src, url: null }));
    return () => {
      cancelled = true;
    };
  }, [src, isLocal, workspaceId]);
  if (!src) return null;
  if (!isLocal) return src;
  return resolved?.src === src ? resolved.url : null;
}
