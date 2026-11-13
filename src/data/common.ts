export class LocalError extends Error {
  constructor(
    public readonly code: "not_found" | "bad_request" | "conflict",
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "LocalError";
  }
}

export const notFound = (message = "Not found") => new LocalError("not_found", message);
export const badRequest = (message = "Invalid request", details?: unknown) => new LocalError("bad_request", message, details);
export const conflict = (message = "Conflict", details?: unknown) => new LocalError("conflict", message, details);

export const now = () => new Date().toISOString();

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export const byRank = <T extends { rank: string }>(a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
