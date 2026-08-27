import type { Metadata, Viewport } from "next";
import { Quicksand, M_PLUS_Rounded_1c } from "next/font/google";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";

// Rounded-terminal Latin typeface for the UI.
const kanaSans = Quicksand({
  variable: "--font-kana-sans",
  subsets: ["latin"],
  display: "swap",
});

// Rounded Japanese companion so subtitles in Japanese stay visually consistent.
// Japanese coverage cannot be preloaded cheaply, so it loads on demand.
const kanaJapanese = M_PLUS_Rounded_1c({
  variable: "--font-kana-jp",
  weight: ["400", "500", "700"],
  preload: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kana — Hermes, with a face and a voice",
  description:
    "A local visual conversation layer for your existing Hermes Agent installation.",
  applicationName: "Kana",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Kana",
  },
};

export const viewport: Viewport = {
  themeColor: "#080d12",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${kanaSans.variable} ${kanaJapanese.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className={`${kanaSans.variable} ${kanaJapanese.variable} bg-bg font-sans text-ink antialiased`} suppressHydrationWarning>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
