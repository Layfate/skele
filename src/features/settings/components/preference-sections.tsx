"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { comboFromEvent, formatCombo, resolvedShortcuts } from "@/features/shell/shortcuts";
import { Monitor, Moon, Sun } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd, modKey } from "@/components/common";
import { ACCENTS, COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { usePreferences, useUpdatePreferences } from "../hooks";
import { SettingsCard } from "./settings-page";

export function AppearanceSection() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const { setTheme } = useTheme();
  if (!prefs.data) return <Skeleton className="h-60" />;
  const p = prefs.data;
  return (
    <>
      <SettingsCard title="Theme">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {(
            [
              ["light", Sun, "Light"],
              ["dark", Moon, "Dark"],
              ["system", Monitor, "System"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={p.theme === value}
              onClick={() => {
                setTheme(value);
                update.mutate({ theme: value });
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border p-4 text-sm hover:bg-accent",
                p.theme === value && "border-brand ring-1 ring-brand",
              )}
            >
              <Icon className="size-5" /> {label}
            </button>
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title="Accent colour" description="Used for buttons, highlights and focus rings.">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={p.accent === a}
              aria-label={COLORS[a].label}
              onClick={() => update.mutate({ accent: a })}
              className={cn("size-8 rounded-full ring-offset-2 ring-offset-card transition", p.accent === a && "ring-2 ring-foreground/70")}
              style={{ background: COLORS[a].hex }}
            />
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title="Density" description="Compact fits more rows in lists, tables and the sidebar.">
        <div className="flex gap-2" role="radiogroup" aria-label="Density">
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={p.density === d}
              onClick={() => update.mutate({ density: d })}
              className={cn("h-9 rounded-md border px-4 text-sm capitalize hover:bg-accent", p.density === d && "border-brand ring-1 ring-brand")}
            >
              {d}
            </button>
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title="Editor text size">
        <div className="flex gap-2" role="radiogroup" aria-label="Editor text size">
          {(["small", "default", "large"] as const).map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={p.fontSize === size}
              onClick={() => update.mutate({ fontSize: size })}
              className={cn("h-9 rounded-md border px-4 text-sm capitalize hover:bg-accent", p.fontSize === size && "border-brand ring-1 ring-brand")}
            >
              {size}
            </button>
          ))}
        </div>
      </SettingsCard>
    </>
  );
}

export function ShortcutsSection() {
  const mod = modKey();
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const [recording, setRecording] = useState<string | null>(null);
  const overrides = useMemo(() => prefs.data?.shortcuts ?? {}, [prefs.data?.shortcuts]);
  const list = useMemo(() => resolvedShortcuts(overrides), [overrides]);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (!combo.includes("mod") && !combo.includes("alt")) {
        toast.error("Use Ctrl/⌘ or Alt in a shortcut so it doesn't fire while typing.");
        return;
      }
      const clash = list.find((s) => s.combo === combo && s.id !== recording);
      if (clash) {
        toast.error(`${formatCombo(combo)} is already used for “${clash.label}”.`);
        return;
      }
      update.mutate({ shortcuts: { ...overrides, [recording]: combo } });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, list, overrides, update]);

  const editor: [string, string[]][] = [
    ["Insert a block", ["/"]],
    ["Link to a page", ["[["]],
    ["Bold / italic / underline", [mod, "B / I / U"]],
    ["Strikethrough", [mod, "Shift", "S"]],
    ["Inline code", [mod, "E"]],
    ["Undo / redo", [mod, "Z / Shift Z"]],
    ["Heading 1 / 2 / 3", ["#", "##", "###"]],
    ["Bulleted / numbered list", ["-", "1."]],
    ["To-do", ["[ ]"]],
    ["Quote / code / divider", [">", "```", "---"]],
  ];
  return (
    <>
      <SettingsCard title="App shortcuts" description="Click a shortcut, then press the new key combination. Esc cancels.">
        <ul className="divide-y">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              {s.label}
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRecording(s.id)}
                  className={cn(
                    "h-7 min-w-24 rounded-md border px-2 text-xs hover:bg-accent",
                    recording === s.id && "border-brand text-brand ring-1 ring-brand",
                  )}
                >
                  {recording === s.id ? "Press keys…" : formatCombo(s.combo)}
                </button>
                {overrides[s.id] && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      const next = { ...overrides };
                      delete next[s.id];
                      update.mutate({ shortcuts: next });
                    }}
                  >
                    Reset
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </SettingsCard>
      <SettingsCard title="Editor">
        <ul className="divide-y">
          {editor.map(([label, keys]) => (
            <li key={label} className="flex items-center justify-between py-2 text-sm">
              {label}
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </>
  );
}
