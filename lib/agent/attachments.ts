import { MAX_ATTACHMENT_BYTES } from "@/lib/limits";

/** Bounds shared by the browser picker and the authenticated upload relay. */
export { MAX_ATTACHMENT_BYTES };
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_TOTAL_BYTES = 2 * MAX_ATTACHMENT_BYTES;
const MAX_ATTACHMENT_MIB = MAX_ATTACHMENT_BYTES / (1024 * 1024);

export type AgentAttachment = { name: string; dataUrl: string };

/** A staging failure guarantees that no prompt was submitted for this turn. */
export class AttachmentUploadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Attachment upload failed.", { cause });
    this.name = "AttachmentUploadError";
  }
}

export function validateAttachment(value: unknown): AgentAttachment {
  if (!value || typeof value !== "object") throw new Error("Invalid attachment.");
  const { name, dataUrl } = value as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(name) || name === "." || name === "..") {
    throw new Error("Invalid attachment filename.");
  }
  if (typeof dataUrl !== "string") throw new Error("Invalid attachment data.");
  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || !match[2].length || match[2].length % 4 !== 0) throw new Error("Invalid base64 attachment.");
  const bytes = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (bytes > MAX_ATTACHMENT_BYTES) throw new Error(`Each file must be at most ${MAX_ATTACHMENT_MIB} MiB.`);
  return { name, dataUrl };
}

export function readAttachment(file: File): Promise<AgentAttachment> {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES) return Promise.reject(new Error(`Choose a non-empty file up to ${MAX_ATTACHMENT_MIB} MiB.`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error("File reading cancelled."));
    reader.onload = () => {
      // Blob.type may contain MIME parameters; use a safe transport MIME.
      const encoded = String(reader.result).split(",")[1];
      try { resolve(validateAttachment({ name: file.name, dataUrl: `data:application/octet-stream;base64,${encoded}` })); }
      catch (error) { reject(error); }
    };
    reader.readAsDataURL(file);
  });
}
