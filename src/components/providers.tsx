"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocalError } from "@/data/common";
import { installDesktopLinkHandler, isDesktop } from "@/lib/desktop";
import { UpdateWatcher } from "@/features/desktop/update-watcher";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Don't hammer the server on client errors (404, 403…).
            // Local reads fail only for real reasons (missing record, invalid data) — don't retry those.
            retry: (count, error) => !(error instanceof LocalError) && count < 1,
            networkMode: "always",
          },
          // Everything is local: mutations must never pause waiting for a network connection.
          mutations: { networkMode: "always" },
        },
      }),
  );

  useEffect(() => installDesktopLinkHandler(), []);
  useEffect(() => {
    // Offline support for the web build. Not used in development or inside the desktop app.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || isDesktop()) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[skele] offline cache unavailable", e));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider delayDuration={400}>
          {children}
          <UpdateWatcher />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
