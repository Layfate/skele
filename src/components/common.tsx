import type { LucideIcon } from "lucide-react";
import { FileText, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { colorHex } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function PageIcon({
  icon,
  kind,
  className,
}: {
  icon?: string | null;
  kind?: "DOCUMENT" | "DATABASE";
  className?: string;
}) {
  if (icon) return <span className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)}>{icon}</span>;
  const Icon = kind === "DATABASE" ? Table2 : FileText;
  return <Icon className={cn("shrink-0 text-muted-foreground", className)} strokeWidth={1.75} />;
}

/** Rounded tile with an emoji or the first letter, tinted by a named colour. */
export function IconTile({
  icon,
  name,
  color,
  className,
}: {
  icon?: string | null;
  name: string;
  color?: string | null;
  className?: string;
}) {
  const hex = colorHex(color);
  return (
    <span
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold", className)}
      style={icon ? { background: `${hex}22` } : { background: hex, color: "white" }}
      aria-hidden
    >
      {icon || name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-muted">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function ColorDot({ color, className }: { color?: string | null; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: colorHex(color) }} />;
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = () => (isMac() ? "⌘" : "Ctrl");
