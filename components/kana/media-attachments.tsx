"use client";

import { memo, useState } from "react";
import type { MediaAttachment } from "@/lib/presentation/media";
import type { Copy } from "@/lib/ui/copy";
import { DownloadIcon, FileIcon } from "./icons";

type ChatCopy = Copy["chat"];

/**
 * Files Hermes delivered in a reply: audio and video play in place, images
 * show a preview, and every file has a download button. The links are
 * Kana's signed /api/media links (see lib/server/media-links.ts).
 */
export const MediaAttachments = memo(function MediaAttachments({
  attachments,
  copy,
}: {
  attachments: MediaAttachment[];
  copy: ChatCopy;
}) {
  if (!attachments.length) return null;
  return (
    <div className="kana-media-list">
      {attachments.map((attachment) => (
        <MediaCard key={attachment.url} attachment={attachment} copy={copy} />
      ))}
    </div>
  );
});

function MediaCard({ attachment, copy }: { attachment: MediaAttachment; copy: ChatCopy }) {
  // A deleted file answers 404: say so instead of a broken player.
  const [missing, setMissing] = useState(false);
  const { url, name, kind } = attachment;
  const onError = () => setMissing(true);
  return (
    <figure className="kana-media-card">
      {!missing && kind === "image" ? (
        <a href={url} target="_blank" rel="noopener" aria-label={copy.openImage(name)} className="kana-focus kana-media-preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed file link, not a Next image asset */}
          <img src={url} alt={name} loading="lazy" onError={onError} />
        </a>
      ) : null}
      {!missing && kind === "video" ? (
        <video className="kana-media-preview" src={url} controls preload="metadata" playsInline onError={onError} />
      ) : null}
      <figcaption className="kana-media-row">
        <FileIcon className="size-4 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold" title={name}>{name}</span>
          {missing ? <span className="block text-[10.5px] opacity-70">{copy.mediaUnavailable}</span> : null}
        </span>
        {!missing ? (
          <a
            href={`${url}?download`}
            download={name}
            aria-label={copy.downloadAria(name)}
            className="kana-focus kana-pill kana-pill-accent shrink-0 px-3 py-1 text-[11px]"
          >
            <DownloadIcon className="size-3.5" />
            <span>{copy.download}</span>
          </a>
        ) : null}
      </figcaption>
      {!missing && kind === "audio" ? (
        <audio className="kana-media-audio" src={url} controls preload="metadata" onError={onError} />
      ) : null}
    </figure>
  );
}
