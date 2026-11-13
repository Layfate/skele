"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocalError } from "@/data/common";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

/**
 * Debounced, ordered autosave to local storage.
 * - One write at a time; the latest edit always wins locally.
 * - `save` throws a "conflict" error if another tab saved a newer version → `onConflict` reloads.
 * - Pending edits are flushed when the tab is hidden, closed or the component unmounts.
 */
export function useAutosave({
  save,
  initialVersion,
  delay = 400,
  onConflict,
  onSaved,
}: {
  save: (doc: object, version: number) => Promise<{ version: number }>;
  initialVersion: number;
  delay?: number;
  onConflict: () => void;
  onSaved?: (version: number) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const version = useRef(initialVersion);
  const pending = useRef<object | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const conflicted = useRef(false);
  const callbacks = useRef({ save, onConflict, onSaved });
  const sendRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    callbacks.current = { save, onConflict, onSaved };
  });

  const later = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void sendRef.current(), ms);
  }, []);

  useEffect(() => {
    sendRef.current = async () => {
      if (inFlight.current || !pending.current || conflicted.current) return;
      const doc = pending.current;
      pending.current = null;
      setStatus("saving");
      let failed = false;
      const run = (async () => {
        try {
          const result = await callbacks.current.save(doc, version.current);
          version.current = result.version;
          callbacks.current.onSaved?.(result.version);
          setStatus(pending.current ? "unsaved" : "saved");
        } catch (e) {
          if (e instanceof LocalError && e.code === "conflict") {
            conflicted.current = true;
            pending.current = null;
            setStatus("saved");
            callbacks.current.onConflict();
            return;
          }
          // Keep the edit and retry shortly (e.g. storage temporarily unavailable).
          failed = true;
          pending.current ??= doc;
          setStatus("error");
          console.error("[skele] save failed", e);
          later(3000);
        }
      })();
      inFlight.current = run;
      await run;
      inFlight.current = null;
      if (!failed && pending.current && !conflicted.current) later(delay);
    };
  }, [delay, later]);

  const schedule = useCallback(
    (doc: object) => {
      pending.current = doc;
      setStatus("unsaved");
      later(delay);
    },
    [later, delay],
  );

  /** Write any pending edit immediately. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    await sendRef.current();
  }, []);

  /** Reset after the document was reloaded from storage. */
  const reset = useCallback((nextVersion: number) => {
    version.current = nextVersion;
    pending.current = null;
    conflicted.current = false;
    setStatus("saved");
  }, []);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush();
    };
  }, [flush]);

  return { status, schedule, reset, flush };
}
