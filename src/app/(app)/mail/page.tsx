import { Suspense } from "react";
import { MailPage } from "@/features/gmail/components/mail-page";

export default function Page() {
  return (
    <Suspense>
      <MailPage />
    </Suspense>
  );
}
