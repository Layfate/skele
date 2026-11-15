import type { TurnUsage } from "../types";

export type TurnImage = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };

export type TurnMessage = { role: "user" | "assistant"; content: string; images?: TurnImage[] };

/** Each callback receives the full text so far (not a delta). */
export type TurnHandlers = {
  text: (full: string) => void;
  thinking: (full: string) => void;
  activity: (line: string) => void;
  session: (id: string) => void;
};

export type TurnResult = {
  text: string;
  thinking?: string;
  activity?: string[];
  /** Tool uses the access mode refused. */
  denied?: string[];
  sessionId?: string;
  stopped?: boolean;
  error?: string;
  usage?: TurnUsage;
  /** The exact model that answered, if the provider said (Claude Code's init event). */
  modelId?: string;
  /** Claude Code's latest plan-limit reading (rate_limit_event), if it sent one. */
  rateLimit?: Record<string, unknown>;
};

export const noHandlers: TurnHandlers = { text: () => {}, thinking: () => {}, activity: () => {}, session: () => {} };
