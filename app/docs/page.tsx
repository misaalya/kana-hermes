import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ConfigGuide } from "@/components/kana/config-guide";

export const metadata: Metadata = { title: "Configuration guide · Kana" };

// Headings, bold labels and table headers use a plain sans; running text
// keeps the app's rounded face. Scoped to this route, so other pages never
// load it; the .kana-doc styles use it.
const docSans = Inter({
  variable: "--font-doc-sans",
  subsets: ["latin"],
  display: "swap",
});

// Read at build time: the page is prerendered, so the packaged server never
// needs the Markdown files. The language is a browser preference, so both
// are sent and the guide picks one after hydration. The paths are literals
// (the same as CONFIG_GUIDE_FILES) so the build traces only these two files,
// not the whole project.
export default async function DocsPage() {
  const [id, en] = await Promise.all([
    readFile(path.join(process.cwd(), "content/docs/configuration.id.md"), "utf8"),
    readFile(path.join(process.cwd(), "content/docs/configuration.en.md"), "utf8"),
  ]);
  return <ConfigGuide sources={{ id, en }} fontClassName={docSans.variable} />;
}
