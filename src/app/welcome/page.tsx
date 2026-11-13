import { Suspense } from "react";
import { WelcomePage } from "@/features/workspaces/components/welcome-page";

export default function Page() {
  return (
    <Suspense>
      <WelcomePage />
    </Suspense>
  );
}
