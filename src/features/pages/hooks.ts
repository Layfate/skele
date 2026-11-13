"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { rankAfter, rankBetween } from "@/lib/rank";
import { workspaceStore } from "@/data/registry";
import * as repo from "@/data/repo/pages";
import type { CreatePageInput, UpdatePageInput } from "@/data/repo/pages";
import type { MovePageInput } from "./schemas";

export type PageList = Awaited<ReturnType<typeof repo.listPages>>;
export type PageListItem = PageList["pages"][number];
export type PageDetail = Awaited<ReturnType<typeof repo.getPage>>;
export type TrashItem = Awaited<ReturnType<typeof repo.listTrash>>[number];
export type RecentItem = Awaited<ReturnType<typeof repo.listRecent>>[number];

export const pageKeys = {
  list: (ws: string) => ["pages", ws] as const,
  one: (ws: string, id: string) => ["page", ws, id] as const,
  trash: (ws: string) => ["trash", ws] as const,
  recent: (ws: string) => ["recent", ws] as const,
  edited: (ws: string) => ["recently-edited", ws] as const,
};

const store = workspaceStore;

export function usePages(ws: string) {
  return useQuery({ queryKey: pageKeys.list(ws), queryFn: () => repo.listPages(store(ws)), enabled: !!ws });
}

export function usePage(ws: string, id: string) {
  return useQuery({
    queryKey: pageKeys.one(ws, id),
    queryFn: () => repo.getPage(store(ws), id),
    // Content is edited locally; don't clobber the editor with background refetches.
    refetchOnWindowFocus: false,
    staleTime: 5_000,
    enabled: !!id,
  });
}

export function useTrash(ws: string, enabled: boolean) {
  return useQuery({ queryKey: pageKeys.trash(ws), queryFn: () => repo.listTrash(store(ws)), enabled });
}

export function useRecent(ws: string) {
  return useQuery({ queryKey: pageKeys.recent(ws), queryFn: () => repo.listRecent(store(ws)) });
}

export function useRecentlyEdited(ws: string) {
  return useQuery({ queryKey: pageKeys.edited(ws), queryFn: () => repo.listRecentlyEdited(store(ws)) });
}

function usePageListUpdater(ws: string) {
  const qc = useQueryClient();
  return {
    qc,
    snapshot: async () => {
      await qc.cancelQueries({ queryKey: pageKeys.list(ws) });
      return qc.getQueryData<PageList>(pageKeys.list(ws));
    },
    set: (fn: (list: PageList) => PageList) =>
      qc.setQueryData<PageList>(pageKeys.list(ws), (list) => (list ? fn(list) : list)),
    restore: (prev: PageList | undefined) => prev && qc.setQueryData(pageKeys.list(ws), prev),
    invalidate: () => {
      qc.invalidateQueries({ queryKey: pageKeys.list(ws) });
      qc.invalidateQueries({ queryKey: pageKeys.edited(ws) });
    },
  };
}

export function useCreatePage(ws: string) {
  const router = useRouter();
  const u = usePageListUpdater(ws);
  return useMutation({
    mutationFn: ({ navigate: _navigate, ...input }: CreatePageInput & { navigate?: boolean }) => repo.createPage(store(ws), input),
    onSuccess: (page, input) => {
      u.set((list) => ({ ...list, pages: [...list.pages, page] }));
      u.invalidate();
      if (input.navigate !== false) router.push(routes.page(page.id));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useUpdatePage(ws: string, id: string) {
  const u = usePageListUpdater(ws);
  return useMutation({
    mutationFn: (input: UpdatePageInput) => repo.updatePage(store(ws), id, input),
    onMutate: async (input) => {
      const prev = await u.snapshot();
      u.set((list) => ({ ...list, pages: list.pages.map((p) => (p.id === id ? { ...p, ...input } : p)) }));
      u.qc.setQueryData<PageDetail>(pageKeys.one(ws, id), (p) => (p ? { ...p, ...input } : p));
      return { prev };
    },
    onError: (e, _i, ctx) => {
      u.restore(ctx?.prev);
      u.qc.invalidateQueries({ queryKey: pageKeys.one(ws, id) });
      toast.error(errorMessage(e));
    },
    onSuccess: () => u.qc.invalidateQueries({ queryKey: pageKeys.edited(ws) }),
  });
}

export function useMovePage(ws: string) {
  const u = usePageListUpdater(ws);
  return useMutation({
    mutationFn: ({ id, ...input }: MovePageInput & { id: string }) => repo.movePage(store(ws), id, input),
    onMutate: async ({ id, parentId, beforeId, afterId }) => {
      const prev = await u.snapshot();
      u.set((list) => {
        const rankOf = (pid?: string | null) => list.pages.find((p) => p.id === pid)?.rank ?? null;
        const siblings = list.pages.filter((p) => p.parentId === parentId && p.id !== id);
        const rank =
          beforeId || afterId
            ? rankBetween(rankOf(beforeId), rankOf(afterId))
            : rankAfter(siblings.map((s) => s.rank).sort().at(-1));
        return {
          ...list,
          pages: list.pages
            .map((p) => (p.id === id ? { ...p, parentId, rank } : p))
            .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)),
        };
      });
      return { prev };
    },
    onError: (e, _i, ctx) => {
      u.restore(ctx?.prev);
      toast.error(errorMessage(e));
    },
    onSettled: (_d, _e, { id }) => {
      u.invalidate();
      u.qc.invalidateQueries({ queryKey: pageKeys.one(ws, id) });
    },
  });
}

/** Ids of `id` and every descendant in a flat page list. */
export function descendantIds(pages: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parentId && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}

export function useArchivePage(ws: string) {
  const u = usePageListUpdater(ws);
  const invalidateAll = (id?: string) => {
    u.invalidate();
    u.qc.invalidateQueries({ queryKey: pageKeys.trash(ws) });
    u.qc.invalidateQueries({ queryKey: pageKeys.recent(ws) });
    if (id) u.qc.invalidateQueries({ queryKey: pageKeys.one(ws, id) });
  };
  return useMutation({
    mutationFn: (id: string) => repo.archivePage(store(ws), id),
    onMutate: async (id) => {
      const prev = await u.snapshot();
      u.set((list) => {
        const gone = descendantIds(list.pages, id);
        return { pages: list.pages.filter((p) => !gone.has(p.id)), favoriteIds: list.favoriteIds.filter((f) => !gone.has(f)) };
      });
      return { prev };
    },
    onSuccess: (_d, id) => {
      toast("Moved to trash", {
        action: { label: "Undo", onClick: () => repo.restorePage(store(ws), id).then(() => invalidateAll(id)) },
      });
    },
    onError: (e, _id, ctx) => {
      u.restore(ctx?.prev);
      toast.error(errorMessage(e));
    },
    onSettled: (_d, _e, id) => invalidateAll(id),
  });
}

export function useRestorePage(ws: string) {
  const u = usePageListUpdater(ws);
  return useMutation({
    mutationFn: (id: string) => repo.restorePage(store(ws), id),
    onSuccess: () => toast.success("Page restored"),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: (_d, _e, id) => {
      u.invalidate();
      u.qc.invalidateQueries({ queryKey: pageKeys.trash(ws) });
      u.qc.invalidateQueries({ queryKey: pageKeys.one(ws, id) });
    },
  });
}

export function usePurgePage(ws: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repo.purgePage(store(ws), id),
    onMutate: (id) => {
      qc.setQueryData<TrashItem[]>(pageKeys.trash(ws), (t) => t?.filter((p) => p.id !== id));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: pageKeys.trash(ws) }),
  });
}

export function useEmptyTrash(ws: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => repo.emptyTrash(store(ws)),
    onSuccess: () => {
      qc.setQueryData(pageKeys.trash(ws), []);
      toast.success("Trash emptied");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useDuplicatePage(ws: string) {
  const router = useRouter();
  const u = usePageListUpdater(ws);
  return useMutation({
    mutationFn: (id: string) => repo.duplicatePage(store(ws), id),
    onSuccess: async ({ id }) => {
      await u.invalidate();
      router.push(routes.page(id));
      toast.success("Page duplicated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useToggleFavorite(ws: string) {
  const u = usePageListUpdater(ws);
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => repo.setFavorite(store(ws), id, favorite),
    onMutate: async ({ id, favorite }) => {
      const prev = await u.snapshot();
      u.set((list) => ({
        ...list,
        favoriteIds: favorite ? [...list.favoriteIds.filter((f) => f !== id), id] : list.favoriteIds.filter((f) => f !== id),
      }));
      u.qc.setQueryData<PageDetail>(pageKeys.one(ws, id), (p) => (p ? { ...p, isFavorite: favorite } : p));
      return { prev };
    },
    onError: (e, _i, ctx) => {
      u.restore(ctx?.prev);
      toast.error(errorMessage(e));
    },
  });
}
