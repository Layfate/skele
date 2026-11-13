import { Suspense } from "react";
import { ProjectsPage } from "@/features/projects/components/projects-page";

export default function Page() {
  return (
    <Suspense>
      <ProjectsPage />
    </Suspense>
  );
}
