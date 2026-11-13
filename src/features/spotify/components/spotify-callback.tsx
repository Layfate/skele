"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { completeConnect } from "../auth";

/** Spotify redirects here after the user approves (or denies) access. */
export function SpotifyCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeConnect(window.location.search)
      .then((next) => router.replace(next))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't connect Spotify"));
  }, [router]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-sidebar p-6 text-center">
      <Logo />
      {error ? (
        <>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <Button asChild variant="outline">
            <Link href="/settings?tab=integrations">Back to settings</Link>
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Connecting Spotify…
        </p>
      )}
    </div>
  );
}
