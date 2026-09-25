import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { parseMarkdown, type MarkdownBlock } from "@/lib/presentation/markdown";
import { readKanaUserConfig } from "@/lib/server/user-config";
import {
  CONFIG_GUIDE_FILES,
  CONFIG_GUIDE_GROUPS,
  CONFIG_GUIDE_PATH_BLOCK,
  headingAnchor,
  readConfigGuide,
} from "@/lib/ui/config-guide";
import type { UiLocale } from "@/lib/ui/copy";

const root = mkdtempSync(path.join(tmpdir(), "kana-config-guide-test-"));
const previousDataDir = process.env.KANA_DATA_DIR;

after(() => {
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

function guide(locale: UiLocale) {
  return readConfigGuide(parseMarkdown(readFileSync(CONFIG_GUIDE_FILES[locale], "utf8")));
}

/** Every block, including those inside lists and quotes. */
function walk(blocks: MarkdownBlock[]): MarkdownBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...(block.type === "list" ? walk(block.items.flat()) : block.type === "quote" ? walk(block.children) : []),
  ]);
}

const SECTION_IDS = CONFIG_GUIDE_GROUPS.flatMap((group) => group.sections);

describe("the /docs config guide", () => {
  for (const locale of ["id", "en"] as const) {
    describe(locale, () => {
      const document = guide(locale);
      const blocks = walk([...document.intro, ...document.sections.flatMap((section) => section.blocks)]);

      it("has a title and one sidebar entry per section, in the sidebar's order", () => {
        assert.ok(document.title);
        assert.deepEqual(
          document.sections.map((section) => section.id),
          SECTION_IDS,
        );
        for (const section of document.sections) assert.ok(section.title && !section.title.includes("{#"));
      });

      it("writes each paragraph on one line", () => {
        // The chat parser turns a single newline into a line break.
        for (const block of blocks) {
          if (block.type === "paragraph") assert.ok(!block.children.some((node) => node.type === "break"));
        }
      });

      it("shows this installation's config path in the overview", () => {
        assert.ok(document.intro.some((block) => block.type === "code" && block.language === CONFIG_GUIDE_PATH_BLOCK));
      });

      it("only gives examples the config parser accepts", () => {
        const examples = blocks.filter(
          (block): block is Extract<MarkdownBlock, { type: "code" }> => block.type === "code" && block.language === "json",
        );
        assert.ok(examples.length >= 8);
        examples.forEach((example, index) => {
          const dataDir = path.join(root, `${locale}-${index}`);
          process.env.KANA_DATA_DIR = dataDir;
          mkdirSync(dataDir, { recursive: true });
          writeFileSync(path.join(dataDir, "config.json"), example.text);
          assert.doesNotThrow(() => readKanaUserConfig(), `example ${index + 1}:\n${example.text}`);
        });
      });
    });
  }

  it("is read by the page from the same files", () => {
    // The page spells the paths out so the build traces only these files.
    const page = readFileSync("app/docs/page.tsx", "utf8");
    for (const file of Object.values(CONFIG_GUIDE_FILES)) assert.ok(page.includes(`"${file}"`), file);
  });

  it("reads a heading's explicit id and hides it", () => {
    const { id, children } = headingAnchor([{ type: "text", text: "Voice engines {#voice}" }]);
    assert.equal(id, "voice");
    assert.deepEqual(children, [{ type: "text", text: "Voice engines" }]);
  });
});
