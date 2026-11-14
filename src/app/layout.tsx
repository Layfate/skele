import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { colorThemeCss } from "@/lib/themes";
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

// Applies the cached colour theme, accent, font size and density before first paint (light/dark
// itself is handled by next-themes).
const appearanceScript = `try{var a=JSON.parse(localStorage.getItem("skele-appearance")||"{}");var d=document.documentElement;d.dataset.accent=a.accent||"indigo";d.dataset.colorTheme=a.colorTheme||"skele";d.dataset.fontSize=a.fontSize||"default";if(a.density)d.dataset.density=a.density}catch(e){}`;
const themeCss = colorThemeCss();

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-accent="indigo"
      data-color-theme="skele"
      data-font-size="default"
      className={`${inter.variable} ${jetbrains.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
        <style id="skele-color-themes" dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
