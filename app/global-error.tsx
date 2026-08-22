"use client";

export default function KanaGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="fatal-error">
          <div className="kana-mark" aria-hidden="true">か</div>
          <p className="eyebrow">Kana could not start</p>
          <h1>The local interface encountered an unexpected error.</h1>
          <p>
            Hermes has not been modified. Retry Kana, or reload the page if the
            problem continues.
          </p>
          {error.digest ? <code>Reference: {error.digest}</code> : null}
          <button className="primary-button" type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
