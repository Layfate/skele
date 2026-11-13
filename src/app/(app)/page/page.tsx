import { Suspense } from "react";
import { PageView } from "@/features/pages/components/page-view";

export default function Page() {
  return (
    <Suspense>
      <PageView />
    </Suspense>
  );
}
