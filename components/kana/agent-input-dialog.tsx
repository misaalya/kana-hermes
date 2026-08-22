import { useMemo, useRef, useState } from "react";
import type {
  AgentInputRequest,
  AgentInputResponse,
} from "@/lib/agent/types";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";

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
      className="agent-input-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void cancel();
      }}
    >
      <section
        className="agent-input-dialog"
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
            <div className="agent-input-heading">
              <span className="agent-input-icon" aria-hidden="true">
                !
              </span>
              <div>
                <h2 id="agent-input-title">Hermes needs approval</h2>
                <p>{request.description}</p>
              </div>
            </div>
            {request.command ? (
              <pre className="approval-command">{request.command}</pre>
            ) : null}
            {request.smartDenied ? (
              <p className="agent-input-warning">
                Hermes safety checks recommended denying this action.
              </p>
            ) : null}
            <div className="agent-input-actions approval-actions">
              {approvalChoices.map((choice) => (
                <button
                  className={
                    choice === "deny" ? "secondary-button" : "primary-button"
                  }
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
            <div className="agent-input-heading">
              <span className="agent-input-icon" aria-hidden="true">
                ?
              </span>
              <div>
                <h2 id="agent-input-title">Hermes has a question</h2>
                <p>{request.question}</p>
              </div>
            </div>
            {request.choices?.length ? (
              <div className="clarification-choices">
                {request.choices.map((choice) => (
                  <button
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
            <label className="agent-input-field">
              Your answer
              <textarea
                autoFocus
                disabled={submitting}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type a response for Hermes…"
                rows={3}
                value={answer}
              />
            </label>
            <div className="agent-input-actions">
              <button
                className="secondary-button"
                disabled={submitting}
                onClick={() => void cancel()}
                type="button"
              >
                Skip
              </button>
              <button
                className="primary-button"
                disabled={submitting || !answer.trim()}
                type="submit"
              >
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
            <div className="agent-input-heading">
              <span className="agent-input-icon" aria-hidden="true">
                ⌁
              </span>
              <div>
                <h2 id="agent-input-title">
                  {request.kind === "sudo"
                    ? "Sudo password required"
                    : request.envVar || "Secret required"}
                </h2>
                <p>
                  {request.kind === "sudo"
                    ? "Hermes needs a password for the current protected command."
                    : request.prompt || "Hermes needs a secret for the current tool."}
                </p>
              </div>
            </div>
            <label className="agent-input-field">
              {request.kind === "sudo" ? "Password" : "Secret value"}
              <input
                autoComplete="off"
                autoFocus
                data-1p-ignore
                disabled={submitting}
                name={`kana-${request.kind}-${request.requestId}`}
                ref={secureInputRef}
                spellCheck={false}
                type="password"
              />
            </label>
            <p className="secure-input-note">
              This value is sent directly to Hermes and is not added to Kana
              history or local preferences.
            </p>
            <div className="agent-input-actions">
              <button
                className="secondary-button"
                disabled={submitting}
                onClick={() => void cancel()}
                type="button"
              >
                Cancel
              </button>
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? "Sending…" : "Send securely"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
