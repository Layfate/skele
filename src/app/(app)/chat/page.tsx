import { Suspense } from "react";
import { ChatPage } from "@/features/ai/components/chat-page";

export default function Page() {
  return (
    <Suspense>
      <ChatPage />
    </Suspense>
  );
}
