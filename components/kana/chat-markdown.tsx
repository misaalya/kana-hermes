"use client";

import { Fragment, memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { ChatCode } from "@/components/kana/chat-code";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import {
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from "@/lib/presentation/markdown";

const HEADINGS = ["h3", "h4", "h5", "h6"] as const;

type HeadingBlock = Extract<MarkdownBlock, { type: "heading" }>;
type CodeBlock = Extract<MarkdownBlock, { type: "code" }>;

/**
 * Lets another page (the /docs guide) reuse this renderer while drawing its
 * own headings and code blocks; everything else renders exactly as in chat.
 */
export type MarkdownRenderers = {
  heading?: (node: HeadingBlock, key: number) => ReactNode;
  code?: (node: CodeBlock, key: number) => ReactNode;
};

type StreamingTail = { node: MarkdownInline; length: number; added: number };

/** The last visible text of the streamed reply, or null when the tip is a
    code block, rule, or table: only real prose gets the fading edge. */
function lastTextLeaf(blocks: MarkdownBlock[]): Extract<MarkdownInline, { type: "text" }> | null {
  const lastLeaf = (nodes: MarkdownInline[]): MarkdownInline | null => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node.type === "strong" || node.type === "em" || node.type === "del" || node.type === "link") {
        const leaf = lastLeaf(node.children);
        if (leaf) return leaf;
        continue;
      }
      return node;
    }
    return null;
  };
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    switch (block.type) {
      case "paragraph":
      case "heading": {
        const leaf = lastLeaf(block.children);
        return leaf?.type === "text" ? leaf : null;
      }
      case "quote":
        return lastTextLeaf(block.children);
      case "list": {
        for (let item = block.items.length - 1; item >= 0; item -= 1) {
          const leaf = lastTextLeaf(block.items[item]);
          if (leaf) return leaf;
        }
        return null;
      }
      default:
        return null;
    }
  }
  return null;
}

/** The newest characters, with trailing whitespace left outside the fade.
    Only the text that arrived in the last chunk takes the jump animation. */
function streamingTail(text: string, length: number, added: number): ReactNode {
  const characters = Array.from(text);
  let end = characters.length;
  while (end > 0 && /\s/.test(characters[end - 1])) end -= 1;
  if (end === 0) return text;
  const start = Math.max(0, end - length);
  const visible = characters.slice(start, end).join("");
  const newest = Math.max(0, Math.min(added, visible.length));
  const split = visible.length - newest;
  return (
    <>
      {characters.slice(0, start).join("")}
      <span className="kana-streaming-tail">
        {visible.slice(0, split)}
        {newest > 0 ? (
          <span key={`new-${text.length}`} className="kana-streaming-new">{visible.slice(split)}</span>
        ) : null}
      </span>
      {characters.slice(end).join("")}
    </>
  );
}

export function renderMarkdownInline(nodes: MarkdownInline[], tail?: StreamingTail): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{tail?.node === node ? streamingTail(node.text, tail.length, tail.added) : node.text}</Fragment>;
      case "break":
        return <br key={index} />;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{renderMarkdownInline(node.children, tail)}</strong>;
      case "em":
        return <em key={index}>{renderMarkdownInline(node.children, tail)}</em>;
      case "del":
        return <del key={index}>{renderMarkdownInline(node.children, tail)}</del>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderMarkdownInline(node.children, tail)}
          </a>
        );
    }
  });
}

export function renderMarkdownBlocks(
  blocks: MarkdownBlock[],
  renderers: MarkdownRenderers = {},
  tail?: StreamingTail,
): ReactNode[] {
  const block = (node: MarkdownBlock, index: number): ReactNode => {
    switch (node.type) {
      case "paragraph":
        return <p key={index}>{renderMarkdownInline(node.children, tail)}</p>;
      case "heading": {
        if (renderers.heading) return renderers.heading(node, index);
        // The chat log sits under the page's h2, so Markdown's # starts at h3.
        const Heading = HEADINGS[Math.min(node.level, 4) - 1];
        return <Heading key={index}>{renderMarkdownInline(node.children, tail)}</Heading>;
      }
      case "code":
        if (renderers.code) return renderers.code(node, index);
        return (
          <pre key={index} tabIndex={0}>
            <code>{node.text}</code>
          </pre>
        );
      case "list": {
        const items = node.items.map((item, itemIndex) => <li key={itemIndex}>{item.map(block)}</li>);
        return node.ordered ? (
          <ol key={index} start={node.start === 1 ? undefined : node.start}>{items}</ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
      case "quote":
        return <blockquote key={index}>{node.children.map(block)}</blockquote>;
      case "rule":
        return <hr key={index} />;
      case "table":
        return (
          <div key={index} className="kana-md-table" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {node.head.map((cell, cellIndex) => (
                    <th key={cellIndex} style={{ textAlign: node.align[cellIndex] ?? undefined }}>{renderMarkdownInline(cell, tail)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {node.head.map((_, cellIndex) => (
                      <td key={cellIndex} style={{ textAlign: node.align[cellIndex] ?? undefined }}>{renderMarkdownInline(row[cellIndex] ?? [], tail)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  };
  return blocks.map(block);
}

/** Hermes' Markdown reply, rendered as elements (never as HTML). While
    streaming, the newest characters carry a gradient into the accent color. */
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  streaming = false,
  locale = "en",
}: {
  text: string;
  streaming?: boolean;
  locale?: UiLocale;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const chatCopy = useMemo(() => getCopy(locale).chat, [locale]);
  const tail = useMemo(() => (streaming ? lastTextLeaf(blocks) : null), [blocks, streaming]);
  const previous = useRef("");
  const added = streaming && text.startsWith(previous.current) ? text.length - previous.current.length : text.length;
  useEffect(() => {
    previous.current = text;
  }, [text]);
  const renderers = useMemo<MarkdownRenderers>(
    () => ({
      code: (node, index) => (
        <ChatCode
          key={index}
          language={node.language}
          code={node.text}
          copy={chatCopy}
          copyable={!streaming}
        />
      ),
    }),
    [chatCopy, streaming],
  );
  return (
    <div className="kana-markdown">
      {renderMarkdownBlocks(blocks, renderers, tail ? { node: tail, length: 12, added } : undefined)}
    </div>
  );
});
