import { NonJsonResponseError, RequestTimeoutError } from "@/lib/runtime/read-json-response";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

/** What the model pickers show when the catalog does not load. */
export type ModelLoadProblem = {
  /** Why it failed, in the interface language. */
  detail: string;
  /** What the user can do next. */
  hint: string;
  /** The HTTP status a proxy answered with, shown as a small code for support. */
  status?: number;
};

const PROXY_TIMEOUT = new Set([504, 522, 524]);
const UNREACHABLE = new Set([502, 503, 520, 521, 523]);

/**
 * Turns a failed model listing into words the user can act on. Kana's own
 * relay always answers JSON, so a page in its place names the layer that
 * failed; an error Kana or Hermes wrote itself is shown as written.
 */
export function describeModelLoadError(locale: UiLocale, reason: unknown): ModelLoadProblem {
  const copy = getCopy(locale).settings;
  if (reason instanceof NonJsonResponseError) {
    const status = reason.status || undefined;
    if (PROXY_TIMEOUT.has(reason.status)) {
      return { detail: copy.modelLoadTimeout, hint: copy.modelLoadTimeoutHint, status };
    }
    if (UNREACHABLE.has(reason.status) || reason.status >= 500) {
      return { detail: copy.modelLoadUnreachable, hint: copy.modelLoadUnreachableHint, status };
    }
    return { detail: copy.modelLoadPage, hint: copy.modelLoadPageHint, status };
  }
  if (reason instanceof RequestTimeoutError) {
    return { detail: copy.modelLoadSlow, hint: copy.modelLoadSlowHint };
  }
  // fetch() rejects with a TypeError when the network itself failed.
  if (reason instanceof TypeError) {
    return { detail: copy.modelLoadOffline, hint: copy.modelLoadOfflineHint };
  }
  const message = reason instanceof Error ? reason.message.trim() : "";
  return { detail: message || copy.modelLoadFailed, hint: "" };
}
