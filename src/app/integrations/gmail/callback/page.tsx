import { Suspense } from "react";
import { GmailCallback } from "@/features/gmail/components/gmail-callback";

export default function Page() {
  return (
    <Suspense>
      <GmailCallback />
    </Suspense>
  );
}
