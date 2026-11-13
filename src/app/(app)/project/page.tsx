import { Suspense } from "react";
import { ProjectPage } from "@/features/projects/components/project-page";

export default function Page() {
  return (
    <Suspense>
      <ProjectPage />
    </Suspense>
  );
}
