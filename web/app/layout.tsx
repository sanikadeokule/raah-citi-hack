import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Provider } from "@/lib/store";

export const metadata: Metadata = {
  title: "Raah",
  description: "Career guidance with cost, payback and scholarships for rural students",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [
  { media: "(prefers-color-scheme: light)", color: "#1b3a6b" },
  { media: "(prefers-color-scheme: dark)", color: "#1b3a6b" },
] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body><Provider>{children}</Provider></body>
    </html>
  );
}
