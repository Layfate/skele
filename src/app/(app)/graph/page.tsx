import { Suspense } from "react";
import { GraphPage } from "@/features/graph/graph-page";

export default function Page() {
  return (
    <Suspense>
      <GraphPage />
    </Suspense>
  );
}
