"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiSettings } from "../hooks";
import { AgentsTab } from "./settings/agents";
import { LocalTab } from "./settings/local";
import { McpTab } from "./settings/mcp";
import { PluginsTab } from "./settings/plugins";
import { ProvidersTab } from "./settings/providers";
import { SkillsTab } from "./settings/skills";
import { UsageTab } from "./settings/usage";

const TABS = [
  { id: "providers", label: "Providers" },
  { id: "local", label: "Local models" },
  { id: "mcp", label: "MCP servers" },
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "agents", label: "Agents" },
  { id: "usage", label: "Usage" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Settings → AI: providers, local models, MCP servers, plugins, skills, agents and usage. */
export function AiSettingsSection() {
  const settings = useAiSettings();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: TabId = TABS.find((t) => t.id === params.get("ai"))?.id ?? "providers";

  if (!settings.data) return <Skeleton className="h-60" />;
  const s = settings.data;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        const next = new URLSearchParams(params.toString());
        next.set("tab", "ai");
        next.set("ai", v);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    >
      <div className="-mx-1 mb-4 overflow-x-auto overflow-y-hidden border-b px-1 pb-1.5 scrollbar-thin">
        <TabsList variant="line" className="h-9">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="px-2.5">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="providers">
        <ProvidersTab settings={s} />
      </TabsContent>
      <TabsContent value="local">
        <LocalTab settings={s} />
      </TabsContent>
      <TabsContent value="mcp">
        <McpTab settings={s} />
      </TabsContent>
      <TabsContent value="plugins">
        <PluginsTab settings={s} />
      </TabsContent>
      <TabsContent value="skills">
        <SkillsTab />
      </TabsContent>
      <TabsContent value="agents">
        <AgentsTab settings={s} />
      </TabsContent>
      <TabsContent value="usage">
        <UsageTab settings={s} />
      </TabsContent>
    </Tabs>
  );
}
