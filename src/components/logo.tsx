import Image from "next/image";
import { cn } from "@/lib/utils";

/** Official Skele logomark: the folded-page "S" on a #121212 tile. */
export const BRAND_BACKGROUND = "#121212";

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/skele-logo.png"
      alt=""
      aria-hidden
      width={64}
      height={64}
      priority
      className={cn("size-7 shrink-0 rounded-[22%] ring-1 ring-white/10", className)}
      style={{ background: BRAND_BACKGROUND }}
    />
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-[17px]">Skele</span>
    </span>
  );
}
