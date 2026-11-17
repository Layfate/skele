"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { Building2, DatabaseBackup, HardDrive, Keyboard, MessagesSquare, Monitor, Palette, Plug, ShieldCheck, SpellCheck, type LucideIcon } from "lucide-react";
import { AiSettingsSection } from "@/features/ai/components/ai-settings";
import { isDesktop } from "@/lib/desktop";
import { DesktopSection } from "@/features/desktop/desktop-section";
import { cn } from "@/lib/utils";
import { Topbar } from "@/features/shell/topbar";
import { AppearanceSection, ShortcutsSection } from "./preference-sections";
import { BackupSection, PrivacySection, StorageSection, WorkspaceSection } from "./workspace-sections";
import { IntegrationsSection } from "./integrations-section";
import { WritingSection } from "./writing-section";

type Section = { id: string; label: string; icon: LucideIcon; group: string; render: () => ReactNode; desktopOnly?: boolean };

const ALL_SECTIONS: Section[] = [
  { id: "workspace", label: "General", icon: Building2, group: "Workspace", render: () => <WorkspaceSection /> },
  { id: "backup", label: "Data & backup", icon: DatabaseBackup, group: "Workspace", render: () => <BackupSection /> },
  { id: "storage", label: "Attachments", icon: HardDrive, group: "Workspace", render: () => <StorageSection /> },
  { id: "appearance", label: "Appearance", icon: Palette, group: "App", render: () => <AppearanceSection /> },
  { id: "writing", label: "Writing", icon: SpellCheck, group: "App", render: () => <WritingSection /> },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard, group: "App", render: () => <ShortcutsSection /> },
  { id: "ai", label: "AI", icon: MessagesSquare, group: "App", render: () => <AiSettingsSection /> },
  { id: "integrations", label: "Integrations", icon: Plug, group: "App", render: () => <IntegrationsSection /> },
  { id: "desktop", label: "Desktop app", icon: Monitor, group: "App", render: () => <DesktopSection />, desktopOnly: true },
  { id: "privacy", label: "Privacy", icon: ShieldCheck, group: "App", render: () => <PrivacySection /> },
];

const noSubscribe = () => () => {};

export function SettingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Hydration-safe: the static HTML is rendered without the desktop shell.
  const desktop = useSyncExternalStore(noSubscribe, isDesktop, () => false);
  const SECTIONS = ALL_SECTIONS.filter((s) => !s.desktopOnly || desktop);
  const tab = SECTIONS.find((s) => s.id === params.get("tab")) ?? SECTIONS[0];
  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <>
      <Topbar crumbs={[{ label: "Settings" }, { label: tab.label }]} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Settings sections" className="shrink-0 border-b px-3 py-3 md:w-56 md:border-r md:border-b-0 md:py-6">
          <div className="flex gap-1 overflow-x-auto md:flex-col md:gap-4">
            {groups.map((g) => (
              <div key={g} className="flex gap-1 md:flex-col md:gap-px">
                <p className="hidden px-2 pb-1 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase md:block">{g}</p>
                {SECTIONS.filter((s) => s.group === g).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-current={s.id === tab.id ? "page" : undefined}
                    onClick={() => router.replace(`${pathname}?tab=${s.id}`, { scroll: false })}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground",
                      s.id === tab.id && "bg-accent font-medium text-foreground",
                    )}
                  >
                    <s.icon className="size-4" strokeWidth={1.75} />
                    {s.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto px-[clamp(1.25rem,4vw,3rem)] py-6 scrollbar-thin">
          <div className="max-w-2xl">
            <h1 className="mb-5 text-xl font-semibold tracking-tight">{tab.label}</h1>
            {tab.render()}
          </div>
        </div>
      </div>
    </>
  );
}

export function SettingsCard({ title, description, children, danger }: { title: string; description?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <section className={cn("mb-5 rounded-xl border bg-card p-5", danger && "border-destructive/40")}>
      <h2 className={cn("font-medium", danger && "text-destructive")}>{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
