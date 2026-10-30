"use client";

import { memo, useMemo } from "react";
import { tokenizeCode } from "@/lib/presentation/code-highlight";
import type { Copy } from "@/lib/ui/copy";
import { CodeBlock as CodeCard } from "./code-block";

/** A chat code card: the raw text is what Copy takes, the tokens only paint it. */
export const ChatCode = memo(function ChatCode({
  language,
  code,
  copy,
  copyable,
}: {
  language: string;
  code: string;
  copy: Copy["chat"];
  copyable: boolean;
}) {
  const tokens = useMemo(() => tokenizeCode(code, language), [code, language]);
  return (
    <CodeCard
      className="kana-chat-code"
      label={language || copy.codeLabel}
      code={code}
      copyLabel={copy.copyCode}
      copiedLabel={copy.copiedCode}
      copyable={copyable}
    >
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          token.text
        ) : (
          <span key={index} className={`kana-code-${token.kind}`}>{token.text}</span>
        ),
      )}
    </CodeCard>
  );
});
