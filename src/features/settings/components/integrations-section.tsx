"use client";

import { GmailSettings } from "@/features/gmail/components/gmail-settings";
import { SpotifySettings } from "@/features/spotify/components/spotify-settings";

export function IntegrationsSection() {
  return (
    <>
      <GmailSettings />
      <SpotifySettings />
    </>
  );
}
