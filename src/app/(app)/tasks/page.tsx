import { Suspense } from "react";
import { MyTasksPage } from "@/features/projects/components/my-tasks-page";

export default function Page() {
  return (
    <Suspense>
      <MyTasksPage />
    </Suspense>
  );
}
