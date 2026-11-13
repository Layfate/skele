import { Suspense } from "react";
import { DatabasesPage } from "@/features/databases/components/databases-page";

export default function Page() {
  return (
    <Suspense>
      <DatabasesPage />
    </Suspense>
  );
}
