"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, DatabaseBackup, Plus, Settings, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTile } from "@/components/common";
import { routes } from "@/lib/routes";
import { pickFile } from "@/features/editor/extensions/skele-storage";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useImportWorkspace, useOpenWorkspace, useWorkspaces } from "../hooks";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

export function WorkspaceSwitcher() {
  const router = useRouter();
  const { workspace, workspaceId } = useWorkspaceCtx();
  const { data: workspaces } = useWorkspaces();
  const open = useOpenWorkspace();
  const importWs = useImportWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent"
          >
            <IconTile icon={workspace.icon} name={workspace.name} color={workspace.color} />
            <span className="truncate font-medium text-foreground">{workspace.name}</span>
            <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Workspaces on this device</DropdownMenuLabel>
          {workspaces?.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              onSelect={() => ws.id !== workspaceId && open.mutate(ws.id, { onSuccess: () => router.push(routes.home) })}
            >
              <IconTile icon={ws.icon} name={ws.name} color={ws.color} className="size-5 text-[11px]" />
              <span className="truncate">{ws.name}</span>
              {ws.id === workspaceId && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              const file = await pickFile(".skele,.json,application/zip,application/json");
              if (file) importWs.mutate(file, { onSuccess: () => router.push(routes.home) });
            }}
          >
            <Upload />
            Import workspace…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={routes.settings("workspace")}>
              <Settings />
              Workspace settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={routes.settings("backup")}>
              <DatabaseBackup />
              Back up &amp; restore
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
