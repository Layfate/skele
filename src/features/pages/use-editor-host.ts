"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { routes } from "@/lib/routes";
import { workspaceStore } from "@/data/registry";
import { createPage } from "@/data/repo/pages";
import { fileObjectUrl } from "@/data/repo/files";
import { FILE_SCHEME } from "@/features/editor/doc";
import type { SkeleHost } from "@/features/editor/extensions/skele-storage";
import { pageKeys, type PageList } from "./hooks";

/** Callbacks the editor needs for `[[links]]`, navigation and local attachments. */
export function useEditorHost(workspaceId: string): Omit<SkeleHost, "upload"> {
  const qc = useQueryClient();
  const router = useRouter();
  return useMemo(() => {
    const list = () => qc.getQueryData<PageList>(pageKeys.list(workspaceId))?.pages ?? [];
    return {
      searchPages: async (query: string) => {
        const q = query.trim().toLowerCase();
        return list()
          .filter((p) => p.kind === "DOCUMENT" || p.kind === "DATABASE")
          .filter((p) => !q || (p.title || "untitled").toLowerCase().includes(q))
          .sort((a, b) => {
            const as = (a.title || "").toLowerCase().startsWith(q) ? 0 : 1;
            const bs = (b.title || "").toLowerCase().startsWith(q) ? 0 : 1;
            return as - bs || b.updatedAt.localeCompare(a.updatedAt);
          })
          .slice(0, 8)
          .map((p) => ({ id: p.id, title: p.title, icon: p.icon }));
      },
      createPage: async (title: string) => {
        const page = await createPage(workspaceStore(workspaceId), { title });
        await qc.invalidateQueries({ queryKey: pageKeys.list(workspaceId) });
        return { id: page.id, title: page.title, icon: page.icon };
      },
      openPage: (id: string) => router.push(routes.page(id)),
      resolveFile: (ref: string) =>
        ref.startsWith(FILE_SCHEME) ? fileObjectUrl(workspaceStore(workspaceId), ref.slice(FILE_SCHEME.length)) : Promise.resolve(ref),
      pageTitle: (id: string) => {
        const p = list().find((x) => x.id === id);
        return p ? p.title || "Untitled" : undefined;
      },
    };
  }, [qc, router, workspaceId]);
}
