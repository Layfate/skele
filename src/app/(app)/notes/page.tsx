import { Suspense } from "react";
import { NotesPage } from "@/features/pages/components/notes-page";

export default function Page() {
  return (
    <Suspense>
      <NotesPage />
    </Suspense>
  );
}
