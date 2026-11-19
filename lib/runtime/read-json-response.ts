// Every Kana /api route answers JSON. A page instead (`<!DOCTYPE html>`) means
// something in front of Kana answered: a reverse proxy or tunnel that timed
// out, a 502 while the server restarts, or a framework error page. Parsing it
// would surface a bare SyntaxError, so callers get an honest message instead.

export class NonJsonResponseError extends Error {
  constructor(readonly status: number) {
    super(
      status >= 500 || status === 0
        ? `The Kana server did not answer (HTTP ${status}). A proxy or tunnel in front of Kana may have timed out, or Kana is restarting; try again.`
        : `The Kana server returned an unexpected page instead of data (HTTP ${status}). Reload Kana and try again.`,
    );
    this.name = "NonJsonResponseError";
  }
}

/** The parsed JSON body, or NonJsonResponseError when the body is not JSON. */
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NonJsonResponseError(response.status);
  }
}

/** A gateway answer worth one retry for a request that is safe to repeat. */
export function isTransientNonJson(error: unknown): boolean {
  return error instanceof NonJsonResponseError
    && [502, 503, 504, 520, 521, 522, 523, 524].includes(error.status);
}

/** The browser gave up waiting for Kana; the message keeps the method for logs. */
export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}
