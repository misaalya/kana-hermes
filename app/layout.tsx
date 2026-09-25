import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";

// One rounded typeface for Latin and Japanese, so UI labels, chat, and
// Japanese subtitles share the same soft letterforms. Only the Latin slice
// is preloaded; the Japanese slices load on demand through unicode-range.
const kanaSans = M_PLUS_Rounded_1c({
  variable: "--font-kana-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kana Hermes",
  description:
    "A local visual conversation layer for your existing Hermes Agent installation.",
  applicationName: "Kana",
  manifest: "/manifest.webmanifest",
  // Tab favicon is public/kana-hermes.png. The PWA install icon stays at
  // public/icon.svg, referenced only from manifest.ts.
  icons: { icon: [{ url: "/kana-hermes.png", type: "image/png" }] },
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
      className={`${kanaSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className={`${kanaSans.variable} bg-bg font-sans text-ink antialiased`} suppressHydrationWarning>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
