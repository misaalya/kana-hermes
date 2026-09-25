import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { MEDIA_CONTENT_SECURITY_POLICY, mediaKind } from "@/lib/presentation/media";

// The HTTP side of GET /api/media/<token>/<name>: stream one delivered file
// with byte ranges, so audio and video can seek, plus revalidation, a real
// file name, and headers that keep a file from running as a page.

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  weba: "audio/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
};

function contentType(file: string): string {
  const extension = path.extname(file).slice(1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** RFC 6266 disposition with an ASCII fallback and the exact UTF-8 name. */
function disposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

type ByteRange = { start: number; end: number };

/** One `bytes=` range, "unsatisfiable", or null for no usable Range header. */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null; // several ranges or malformed: send it all
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

export function mediaResponse(request: Request, file: string, method: "GET" | "HEAD" = "GET"): Response {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return notAvailable();
  }
  const name = path.basename(file);
  const inline = mediaKind(name) !== "file" && !new URL(request.url).searchParams.has("download");
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = new Headers({
    "Content-Type": contentType(file),
    "Content-Disposition": disposition(inline ? "inline" : "attachment", name),
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString(),
    // Private to this login; revalidated so a rewritten file is never stale.
    "Cache-Control": "private, no-cache",
    // Opened on its own, a file (an SVG, say) can never run script as Kana.
    "Content-Security-Policy": MEDIA_CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });

  if (request.headers.get("if-none-match")?.split(",").some((tag) => tag.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }

  // If-Range: resume only while the file is unchanged, else send it whole.
  const ifRange = request.headers.get("if-range");
  const range = ifRange && ifRange !== etag ? null : parseRange(request.headers.get("range"), stat.size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range ?? { start: 0, end: stat.size - 1 };
  const length = stat.size === 0 ? 0 : end - start + 1;
  headers.set("Content-Length", String(length));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  const status = range ? 206 : 200;
  if (method === "HEAD" || length === 0) return new Response(null, { status, headers });

  const stream = fs.createReadStream(file, { start, end });
  request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}

export function notAvailable(): Response {
  return Response.json(
    { error: "This file is no longer available." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
