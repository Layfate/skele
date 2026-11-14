import type { TurnUsage } from "../types";

export type TurnMessage = { role: "user" | "assistant"; content: string };

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
  /** Claude Code's latest plan-limit reading (rate_limit_event), if it sent one. */
  rateLimit?: Record<string, unknown>;
};

export const noHandlers: TurnHandlers = { text: () => {}, thinking: () => {}, activity: () => {}, session: () => {} };
