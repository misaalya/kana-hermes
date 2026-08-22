"use client";

export default function KanaErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="fatal-error">
      <div className="kana-mark" aria-hidden="true">か</div>
      <p className="eyebrow">Kana needs attention</p>
      <h1>The workspace could not continue safely.</h1>
      <p>
        Your local conversation data was not intentionally removed. Try the
        workspace again; if the problem repeats, reload Kana and copy the safe
        diagnostics from Settings.
      </p>
      {error.digest ? <code>Reference: {error.digest}</code> : null}
      <button className="primary-button" type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
