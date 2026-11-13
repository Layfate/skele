import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Skele",
    short_name: "Skele",
    description: "A calm, fast workspace for notes, projects and structured data.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#121212",
    theme_color: "#121212",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/skele-logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
