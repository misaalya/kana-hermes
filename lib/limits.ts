// Request-size limits shared by route handlers, browser pre-checks, the Next
// proxy buffer (next.config.ts), and the documented Nginx configuration.
// Change them here only; tests assert that they stay mutually consistent.

const MIB = 1024 * 1024;

/** One chat attachment's raw bytes (sent base64-encoded inside JSON). */
export const MAX_ATTACHMENT_BYTES = 10 * MIB;

/** One voice-clone reference recording (multipart upload). */
export const MAX_VOICE_REFERENCE_BYTES = 10 * MIB;

/** JSON body that carries one base64 attachment plus its metadata. */
export const MAX_ATTACHMENT_REQUEST_BYTES = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4096;

/** Multipart overhead allowance around a voice reference file. */
export const MAX_VOICE_REQUEST_BYTES = MAX_VOICE_REFERENCE_BYTES + 64 * 1024;

/**
 * The largest request any Kana route accepts. Next's proxy buffers request
 * bodies only up to this size and silently truncates anything longer, so it
 * must cover every route limit. Nginx's client_max_body_size must match
 * (docs: "14m").
 */
export const MAX_REQUEST_BODY_BYTES = 14 * MIB;

/** Hermes RPCs that legitimately run for minutes (compression, model catalogs). */
export const LONG_HERMES_RPC_TIMEOUT_MS = 180_000;
