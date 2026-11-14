import Image from "next/image";
import { cn } from "@/lib/utils";

/** Official Skele logomark: the folded-page "S", on a transparent background. On light
 * backgrounds a soft shadow keeps the white page visible. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/skele-mark.png"
      alt=""
      aria-hidden
      width={64}
      height={64}
      priority
      className={cn("size-7 shrink-0 drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.3)] dark:drop-shadow-none", className)}
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
