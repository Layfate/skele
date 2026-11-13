import { Suspense } from "react";
import { ShellSkeleton, WorkspaceShell } from "@/features/shell/workspace-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  );
}
