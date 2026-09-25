// Files Hermes hands to the user. Hermes marks them with `MEDIA:/local/path`
// in a reply (the convention its Telegram/Discord gateways deliver as native
// attachments). Kana's server swaps each deliverable path for a signed link
// under MEDIA_ROUTE before any payload reaches the browser (see
// lib/server/media-links.ts), so the browser only ever sees
// `MEDIA:/api/media/<token>/<file name>` and never a local path.

export const MEDIA_ROUTE = "/api/media";

/**
 * The policy for a delivered file opened on its own: a sandboxed document
 * with no script. Set by next.config.ts for MEDIA_ROUTE (it must replace the
 * app's policy there) and by the route itself.
 */
export const MEDIA_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

export type MediaKind = "audio" | "video" | "image" | "file";

export type MediaAttachment = {
  /** The signed link that streams the file. */
  url: string;
  /** The file's own name, for the label and the download. */
  name: string;
  kind: MediaKind;
};

/**
 * Extensions the browser plays or shows inline. Everything else, SVG and PDF
 * included, is offered as a download only.
 */
const INLINE_EXTENSIONS: Record<string, Exclude<MediaKind, "file">> = {
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  opus: "audio",
  flac: "audio",
  weba: "audio",
  mp4: "video",
  m4v: "video",
  webm: "video",
  mov: "video",
  ogv: "video",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
};

export function mediaKind(name: string): MediaKind {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return (extension && INLINE_EXTENSIONS[extension]) || "file";
}

/** Hermes's per-file delivery hints; they mean nothing on screen. */
const DIRECTIVES = /\[\[(?:audio_as_voice|as_document)\]\]/g;

// The server writes the token and the percent-encoded name with unreserved
// characters only, so the link ends at the first character outside them, and
// never on a dot (the full stop of a sentence).
const MEDIA_LINK = new RegExp(
  String.raw`\**MEDIA:[^\S\n]*(${MEDIA_ROUTE}/[A-Za-z0-9_-]+/[A-Za-z0-9%._~-]*[A-Za-z0-9%_~-])\**`,
  "g",
);

function fileName(url: string): string {
  const last = url.slice(url.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Split a reply into its text and the files it delivers. The tags leave the
 * text (the files render as players and download cards instead), and the
 * blank lines they leave behind collapse.
 */
export function extractMediaAttachments(text: string): { text: string; attachments: MediaAttachment[] } {
  if (!text.includes("MEDIA:") && !text.includes("[[")) return { text, attachments: [] };
  const attachments: MediaAttachment[] = [];
  const stripped = text.replace(DIRECTIVES, "").replace(MEDIA_LINK, (_tag, url: string) => {
    if (!attachments.some((attachment) => attachment.url === url)) {
      const name = fileName(url);
      attachments.push({ url, name, kind: mediaKind(name) });
    }
    return "";
  });
  return {
    text: stripped
      .replace(/^[^\S\n]*[.,;:!?]+[^\S\n]*$/gm, "") // a full stop left behind alone
      .replace(/[^\S\n]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    attachments,
  };
}

/** One line for a history preview: the text, or the file names alone. */
export function mediaPreviewText(text: string | undefined): string | undefined {
  if (!text) return text;
  const { text: rest, attachments } = extractMediaAttachments(text);
  return rest || attachments.map((attachment) => attachment.name).join(", ") || undefined;
}
