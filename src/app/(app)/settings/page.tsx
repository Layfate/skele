import { Suspense } from "react";
import { SettingsPage } from "@/features/settings/components/settings-page";

export default function Page() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
