"use client";

import { useSyncExternalStore } from "react";
import { isDesktop } from "@/lib/desktop";

const noSubscribe = () => () => {};

/**
 * Whether this is the desktop app, without a hydration mismatch: the static HTML is built
 * for the browser, so the first render says false and React updates it right after.
 */
export function useIsDesktop() {
  return useSyncExternalStore(noSubscribe, isDesktop, () => false);
}
