import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Skele", template: "%s · Skele" },
  description: "A calm, fast workspace for notes, projects and structured data.",
  applicationName: "Skele",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#16171b" },
  ],
};

// Applies the cached accent + font size before first paint (theme itself is handled by next-themes).
const appearanceScript = `try{var a=JSON.parse(localStorage.getItem("skele-appearance")||"{}");var d=document.documentElement;d.dataset.accent=a.accent||"indigo";d.dataset.fontSize=a.fontSize||"default"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-accent="indigo"
      data-font-size="default"
      className={`${inter.variable} ${jetbrains.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
