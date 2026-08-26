"use client";

import { useMemo, useRef, useState } from "react";
import type {
  AgentInputRequest,
  AgentInputResponse,
} from "@/lib/agent/types";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { btnPrimary, btnSecondary, bentoCard, inputBase } from "./ui";

type AgentInputDialogProps = {
  request: AgentInputRequest;
  submitting: boolean;
  onRespond(response: AgentInputResponse): Promise<void>;
};

function approvalLabel(choice: string): string {
  if (choice === "once") return "Run once";
  if (choice === "session") return "Allow for session";
  if (choice === "always") return "Always allow";
  if (choice === "deny") return "Deny";
  return choice.replaceAll("_", " ");
}

export function AgentInputDialog({
  request,
  submitting,
  onRespond,
}: AgentInputDialogProps) {
  const secureInputRef = useRef<HTMLInputElement | null>(null);
  const [answer, setAnswer] = useState("");

  const approvalChoices = useMemo(() => {
    if (request.kind !== "approval") return [];
    const source = request.choices?.length
      ? request.choices
      : request.smartDenied
        ? ["once", "deny"]
        : [
            "once",
            "session",
            ...(request.allowPermanent ? ["always"] : []),
            "deny",
          ];
    return source.filter(
      (choice, index) =>
        (request.allowPermanent || choice !== "always") &&
        source.indexOf(choice) === index,
    );
  }, [request]);

  const cancel = async () => {
    if (submitting) return;
    if (request.kind === "approval") {
      await onRespond({ kind: "approval", choice: "deny" });
    } else if (request.kind === "clarification") {
      await onRespond({
        kind: "clarification",
        requestId: request.requestId,
        answer: "",
      });
    } else if (request.kind === "sudo") {
      await onRespond({
        kind: "sudo",
        requestId: request.requestId,
        password: "",
      });
    } else {
      await onRespond({ kind: "secret", requestId: request.requestId, value: "" });
    }
  };

  const submitSecureValue = async () => {
    const value = secureInputRef.current?.value ?? "";
    if (secureInputRef.current) secureInputRef.current.value = "";
    if (request.kind === "sudo") {
      await onRespond({
        kind: "sudo",
        requestId: request.requestId,
        password: value,
      });
    } else if (request.kind === "secret") {
      await onRespond({ kind: "secret", requestId: request.requestId, value });
    }
  };
  const { dialogRef, onDialogKeyDown } = useDialogFocus(() => {
    void cancel();
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/85 p-3"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void cancel();
      }}
    >
      <section
        className="w-[min(480px,100%)] rounded-2xl border border-line bg-bg p-3"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-input-title"
        onKeyDown={(event) => {
          onDialogKeyDown(event);
        }}
      >
        {request.kind === "approval" ? (
          <>
            <div className={`mb-2 ${bentoCard}`}>
              <div className="min-w-0">
                <h2 id="agent-input-title" className="text-sm font-bold text-ink">Hermes needs approval</h2>
                <p className="mt-0.5 text-xs leading-relaxed break-words text-ink-dim">{request.description}</p>
              </div>
            </div>
            {request.command ? (
              <pre className="mb-2 overflow-x-auto rounded-2xl border border-line bg-surface p-3 font-mono text-xs text-accent-strong">{request.command}</pre>
            ) : null}
            {request.smartDenied ? (
              <p className="mb-2 rounded-2xl border border-danger/40 px-3.5 py-2.5 text-xs font-semibold text-danger">
                Hermes safety checks recommended denying this action.
              </p>
            ) : null}
            <div className={`flex flex-wrap gap-2 ${bentoCard}`}>
              {approvalChoices.map((choice) => (
                <button
                  className={choice === "deny" ? btnSecondary : `${btnPrimary} grow`}
                  disabled={submitting}
                  key={choice}
                  onClick={() => void onRespond({ kind: "approval", choice })}
                  type="button"
                >
                  {approvalLabel(choice)}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {request.kind === "clarification" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onRespond({
                kind: "clarification",
                requestId: request.requestId,
                answer: answer.trim(),
              });
            }}
          >
            <div className={`mb-2 ${bentoCard}`}>
              <div className="min-w-0">
                <h2 id="agent-input-title" className="text-sm font-bold text-ink">Hermes has a question</h2>
                <p className="mt-0.5 text-xs leading-relaxed break-words text-ink-dim">{request.question}</p>
              </div>
            </div>
            {request.choices?.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5 rounded-2xl border border-line bg-surface p-3">
                {request.choices.map((choice) => (
                  <button
                    className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink-dim transition-colors hover:border-accent hover:text-accent-strong"
                    disabled={submitting}
                    key={choice}
                    onClick={() =>
                      void onRespond({
                        kind: "clarification",
                        requestId: request.requestId,
                        answer: choice,
                      })
                    }
                    type="button"
                  >
                    {choice}
                  </button>
                ))}
              </div>
            ) : null}
            <label className={`mb-2 flex flex-col gap-1.5 ${bentoCard}`}>
              <span className="text-[11px] font-semibold text-muted">Your answer</span>
              <textarea
                autoFocus
                disabled={submitting}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type a response for Hermes…"
                rows={3}
                value={answer}
                className={`${inputBase} resize-y`}
              />
            </label>
            <div className={`flex justify-end gap-2 ${bentoCard}`}>
              <button type="button" className={btnSecondary} disabled={submitting} onClick={() => void cancel()}>
                Skip
              </button>
              <button type="submit" className={btnPrimary} disabled={submitting || !answer.trim()}>
                Send answer
              </button>
            </div>
          </form>
        ) : null}

        {request.kind === "sudo" || request.kind === "secret" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitSecureValue();
            }}
          >
            <div className={`mb-2 ${bentoCard}`}>
              <div className="min-w-0">
                <h2 id="agent-input-title" className="text-sm font-bold break-words text-ink">
                  {request.kind === "sudo"
                    ? "Sudo password required"
                    : request.envVar || "Secret required"}
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">
                  {request.kind === "sudo"
                    ? "Hermes needs a password for the current protected command."
                    : request.prompt || "Hermes needs a secret for the current tool."}
                </p>
              </div>
            </div>
            <label className={`mb-2 flex flex-col gap-1.5 ${bentoCard}`}>
              <span className="text-[11px] font-semibold text-muted">
                {request.kind === "sudo" ? "Password" : "Secret value"}
              </span>
              <input
                autoComplete="off"
                autoFocus
                data-1p-ignore
                disabled={submitting}
                name={`kana-${request.kind}-${request.requestId}`}
                ref={secureInputRef}
                spellCheck={false}
                type="password"
                className={inputBase}
              />
              <span className="text-[10px] leading-relaxed text-faint">
                Sent directly to Hermes; never added to Kana history or local preferences.
              </span>
            </label>
            <div className={`flex justify-end gap-2 ${bentoCard}`}>
              <button type="button" className={btnSecondary} disabled={submitting} onClick={() => void cancel()}>
                Cancel
              </button>
              <button type="submit" className={btnPrimary} disabled={submitting}>
                {submitting ? "Sending…" : "Send securely"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
