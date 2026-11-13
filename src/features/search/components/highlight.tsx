import { cn } from "@/lib/utils";

/** Renders `text` with case-insensitive matches of `query` wrapped in <mark> — no HTML injection. */
export function Highlight({ text, query, className }: { text: string; query: string; className?: string }) {
  const q = query.trim();
  if (!q) return <span className={className}>{text}</span>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      parts.push({ text: text.slice(i), match: false });
      break;
    }
    if (at > i) parts.push({ text: text.slice(i, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    i = at + needle.length;
  }
  return (
    <span className={cn(className)}>
      {parts.map((p, idx) =>
        p.match ? (
          <mark key={idx} className="rounded-sm bg-brand-soft px-px text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={idx}>{p.text}</span>
        ),
      )}
    </span>
  );
}
