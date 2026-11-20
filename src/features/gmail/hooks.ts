"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { errorText } from "@/lib/oauth";
import {
  getMail,
  GmailError,
  listMail,
  profile,
  sendMail,
  unreadInbox,
  type Draft,
  type Folder,
} from "./api";
import {
  aiAccess,
  builtInClient,
  endedReason,
  isConnected,
  ownClient,
  setAiAccess,
} from "./auth";

export const gmailKeys = {
  all: ["gmail"] as const,
  status: ["gmail", "status"] as const,
  profile: ["gmail", "profile"] as const,
  list: (folder: Folder, query: string) =>
    ["gmail", "list", folder, query] as const,
  message: (id: string) => ["gmail", "message", id] as const,
  unread: ["gmail", "unread"] as const,
  ai: ["gmail", "ai"] as const,
};

export function useGmailStatus() {
  return useQuery({
    queryKey: gmailKeys.status,
    queryFn: async () => {
      const [connected, client, ended] = await Promise.all([
        isConnected(),
        ownClient(),
        endedReason(),
      ]);
      return { connected, client, builtIn: !!builtInClient(), ended };
    },
    staleTime: Infinity,
  });
}

/** When a request finds the sign-in gone, refresh the connection status everywhere. */
function useOnNotConnected() {
  const qc = useQueryClient();
  return (e: unknown) => {
    if (e instanceof GmailError && e.kind === "not-connected")
      qc.invalidateQueries({ queryKey: gmailKeys.status });
  };
}

export function useGmailProfile(enabled: boolean) {
  return useQuery({
    queryKey: gmailKeys.profile,
    queryFn: profile,
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

export function useMailList(folder: Folder, query: string, enabled: boolean) {
  const notConnected = useOnNotConnected();
  return useInfiniteQuery({
    queryKey: gmailKeys.list(folder, query),
    queryFn: async ({ pageParam }) => {
      try {
        return await listMail({ folder, query, pageToken: pageParam });
      } catch (e) {
        notConnected(e);
        throw e;
      }
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
    enabled,
    staleTime: 60_000,
    refetchInterval: folder === "inbox" && !query ? 2 * 60_000 : false,
    retry: false,
  });
}

export function useMail(id: string | null) {
  const notConnected = useOnNotConnected();
  return useQuery({
    queryKey: gmailKeys.message(id ?? ""),
    queryFn: async () => {
      try {
        return await getMail(id!);
      } catch (e) {
        notConnected(e);
        throw e;
      }
    },
    enabled: !!id,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Unread messages in the inbox, for the sidebar badge; polled every 2 minutes. */
export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: gmailKeys.unread,
    queryFn: unreadInbox,
    enabled,
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSendMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: Draft) => sendMail(d),
    onSuccess: () => {
      toast.success("Email sent");
      qc.invalidateQueries({ queryKey: ["gmail", "list"] });
    },
    onError: (e) => toast.error(errorText(e, "Couldn't send the email.")),
  });
}

export function useGmailAiAccess() {
  return useQuery({
    queryKey: gmailKeys.ai,
    queryFn: aiAccess,
    staleTime: Infinity,
  });
}

export function useSetGmailAiAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => setAiAccess(on),
    onMutate: (on) => qc.setQueryData(gmailKeys.ai, on),
  });
}
