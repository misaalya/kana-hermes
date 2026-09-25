import type { MarkdownBlock, MarkdownInline } from "@/lib/presentation/markdown";
import type { UiLocale } from "./copy";

// The /docs config guide is plain Markdown in content/docs, one file per
// language, read by the chat's own parser (lib/presentation/markdown.ts).
// Each language is written on its own in a formal register (Indonesian uses
// "Anda"), not translated line by line. Keep the facts in step with
// lib/server/user-config.ts (the parser is the source of truth) and
// docs/CONFIGURATION.md; tests/presentation/config-guide.test.ts checks the
// structure and that every JSON example is accepted by that parser.
//
// Conventions on top of the chat subset:
// - `# Title` names the page and the text before the first `##` is its
//   overview; each `## Section {#id}` is one entry in the sidebar, with an
//   id shared by both languages (deep links, icons);
// - a fenced block tagged `kana-config-path` shows this installation's own
//   config.json path, with its text as the fallback;
// - in-page links are not available (the chat parser keeps only web and
//   mail links); the sidebar is the table of contents;
// - a paragraph is one line: a single newline is a line break in chat.

export const CONFIG_GUIDE_FILES: Record<UiLocale, string> = {
  id: "content/docs/configuration.id.md",
  en: "content/docs/configuration.en.md",
};

export const CONFIG_GUIDE_PATH_BLOCK = "kana-config-path";

export type ConfigGuideSectionId =
  | "quickstart"
  | "voice"
  | "irodori"
  | "pollinations"
  | "hermes"
  | "deployment"
  | "environment"
  | "troubleshooting";

export type ConfigGuideCopy = {
  docs: string;
  back: string;
  contents: string;
  groups: { basics: string; voice: string; system: string; help: string };
  copy: string;
  copied: string;
  mode: string;
  modeLocal: string;
  modeDeployment: string;
  configError: string;
};

export const CONFIG_GUIDE_GROUPS: {
  id: keyof ConfigGuideCopy["groups"];
  sections: ConfigGuideSectionId[];
}[] = [
  { id: "basics", sections: ["quickstart"] },
  { id: "voice", sections: ["voice", "irodori", "pollinations"] },
  { id: "system", sections: ["hermes", "deployment", "environment"] },
  { id: "help", sections: ["troubleshooting"] },
];

const COPY: Record<UiLocale, ConfigGuideCopy> = {
  id: {
    docs: "Dokumentasi",
    back: "Kembali ke Kana",
    contents: "Daftar isi",
    groups: { basics: "Dasar", voice: "Suara", system: "Sistem", help: "Bantuan" },
    copy: "Salin",
    copied: "Tersalin",
    mode: "Mode",
    modeLocal: "Lokal",
    modeDeployment: "Deployment",
    configError: "Terdapat kesalahan pada config.json:",
  },
  en: {
    docs: "Documentation",
    back: "Back to Kana",
    contents: "Contents",
    groups: { basics: "Basics", voice: "Voice", system: "System", help: "Help" },
    copy: "Copy",
    copied: "Copied",
    mode: "Mode",
    modeLocal: "Local",
    modeDeployment: "Deployment",
    configError: "config.json contains an error:",
  },
};

export function getConfigGuideCopy(locale: UiLocale): ConfigGuideCopy {
  return COPY[locale];
}

export type ConfigGuideSection = {
  id: string;
  title: string;
  heading: MarkdownInline[];
  blocks: MarkdownBlock[];
};

export type ConfigGuideDocument = {
  title: string;
  intro: MarkdownBlock[];
  sections: ConfigGuideSection[];
};

export function plainText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.text;
      if (node.type === "break") return " ";
      return plainText(node.children);
    })
    .join("");
}

const ANCHOR = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

/** A heading's trailing `{#id}`, removed from what is shown. */
export function headingAnchor(nodes: MarkdownInline[]): { id: string | null; children: MarkdownInline[] } {
  const last = nodes.at(-1);
  const match = last?.type === "text" ? ANCHOR.exec(last.text) : null;
  if (!last || last.type !== "text" || !match) return { id: null, children: nodes };
  const text = last.text.slice(0, match.index);
  return { id: match[1], children: text ? [...nodes.slice(0, -1), { type: "text", text }] : nodes.slice(0, -1) };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The page title, the text before the first section, and one entry per `##`. */
export function readConfigGuide(blocks: MarkdownBlock[]): ConfigGuideDocument {
  let title = "";
  const intro: MarkdownBlock[] = [];
  const sections: ConfigGuideSection[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && block.level === 1 && !title && !sections.length) {
      title = plainText(block.children).trim();
    } else if (block.type === "heading" && block.level === 2) {
      const { id, children } = headingAnchor(block.children);
      const text = plainText(children).trim();
      sections.push({ id: id ?? slug(text), title: text, heading: children, blocks: [] });
    } else {
      (sections.at(-1)?.blocks ?? intro).push(block);
    }
  }
  return { title, intro, sections };
}
