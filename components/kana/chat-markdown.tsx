import { Fragment, memo, useMemo, type ReactNode } from "react";
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

export function renderMarkdownInline(nodes: MarkdownInline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "break":
        return <br key={index} />;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{renderMarkdownInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderMarkdownInline(node.children)}</em>;
      case "del":
        return <del key={index}>{renderMarkdownInline(node.children)}</del>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderMarkdownInline(node.children)}
          </a>
        );
    }
  });
}

export function renderMarkdownBlocks(blocks: MarkdownBlock[], renderers: MarkdownRenderers = {}): ReactNode[] {
  const block = (node: MarkdownBlock, index: number): ReactNode => {
    switch (node.type) {
      case "paragraph":
        return <p key={index}>{renderMarkdownInline(node.children)}</p>;
      case "heading": {
        if (renderers.heading) return renderers.heading(node, index);
        // The chat log sits under the page's h2, so Markdown's # starts at h3.
        const Heading = HEADINGS[Math.min(node.level, 4) - 1];
        return <Heading key={index}>{renderMarkdownInline(node.children)}</Heading>;
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
                    <th key={cellIndex} style={{ textAlign: node.align[cellIndex] ?? undefined }}>{renderMarkdownInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {node.head.map((_, cellIndex) => (
                      <td key={cellIndex} style={{ textAlign: node.align[cellIndex] ?? undefined }}>{renderMarkdownInline(row[cellIndex] ?? [])}</td>
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

/** Hermes' Markdown reply, rendered as elements (never as HTML). */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="kana-markdown">{renderMarkdownBlocks(blocks)}</div>;
});
