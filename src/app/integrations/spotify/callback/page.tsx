import { Suspense } from "react";
import { SpotifyCallback } from "@/features/spotify/components/spotify-callback";

export default function Page() {
  return (
    <Suspense>
      <SpotifyCallback />
    </Suspense>
  );
}
