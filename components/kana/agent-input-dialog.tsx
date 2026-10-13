"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  AgentInputRequest,
  AgentInputResponse,
} from "@/lib/agent/types";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { revealCommand } from "@/lib/presentation/command-text";
import { BotIcon, CheckIcon } from "./icons";
import { btnPrimary, btnSecondary, bentoCard, inputBase } from "./ui";
import { getCopy, type UiLocale } from "@/lib/ui/copy";

type AgentInputDialogProps = {
  request: AgentInputRequest;
  submitting: boolean;
  onRespond(response: AgentInputResponse): Promise<void>;
  locale: UiLocale;
};

/**
 * An approval that appears while the user is typing or clicking must not take
 * that input: the dialog opens with focus on itself, and for this long after
 * it opens only Deny is enabled (browsers guard permission prompts the same way).
 */
const APPROVAL_ARM_DELAY_MS = 600;

function approvalLabel(choice: string, copy: ReturnType<typeof getCopy>["agentInput"]): string {
  if (choice === "once") return copy.runOnce;
  if (choice === "session") return copy.allowSession;
  if (choice === "always") return copy.alwaysAllow;
  if (choice === "deny") return copy.deny;
  return choice.replaceAll("_", " ");
}

/**
 * One Hermes clarify call: one to five independent questions answered in one
 * form. Each answer locks its question server-side (`question_id`); the final
 * lock unblocks the agent. Skipping cancels the whole call.
 */
function ClarificationForm({
  request,
  drafts,
  picked,
  setDrafts,
  setPicked,
  submitting,
  onRespond,
  onCancel,
  copy,
}: {
  request: Extract<AgentInputRequest, { kind: "clarification" }>;
  drafts: Record<string, string>;
  picked: Record<string, string[]>;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setPicked: Dispatch<SetStateAction<Record<string, string[]>>>;
  submitting: boolean;
  onRespond(response: AgentInputResponse): Promise<void>;
  onCancel(): void;
  copy: ReturnType<typeof getCopy>["agentInput"];
}) {
  const answerFor = (qid: string, multiSelect: boolean): string => {
    const list = picked[qid] ?? [];
    if (list.length) return multiSelect ? JSON.stringify(list) : list[0];
    return (drafts[qid] ?? "").trim();
  };

  const toggleChoice = (qid: string, multiSelect: boolean, choice: string) => {
    setPicked((previous) => {
      const current = previous[qid] ?? [];
      if (multiSelect) {
        const next = current.includes(choice)
          ? current.filter((item) => item !== choice)
          : [...current, choice];
        return { ...previous, [qid]: next };
      }
      return { ...previous, [qid]: [choice] };
    });
    // Picking a choice and typing are mutually exclusive answers.
    setDrafts((previous) => ({ ...previous, [qid]: "" }));
  };

  const editDraft = (qid: string, value: string) => {
    setDrafts((previous) => ({ ...previous, [qid]: value }));
    if (value.trim()) {
      setPicked((previous) => {
        if (!(qid in previous)) return previous;
        const next = { ...previous };
        delete next[qid];
        return next;
      });
    }
  };

  const submit = () => {
    void onRespond({
      kind: "clarification",
      requestId: request.requestId,
      answers: request.questions.map((entry) => ({
        qid: entry.qid,
        answer: answerFor(entry.qid, entry.multiSelect),
      })),
      cancelled: false,
    });
  };

  const single = request.questions.length === 1;

  const hasAnyAnswer = request.questions.some((entry) => {
    const list = picked[entry.qid] ?? [];
    return list.length > 0 || (drafts[entry.qid] ?? "").trim().length > 0;
  });

  // Letters pick a choice without touching the mouse; Enter confirms. While
  // typing, only Ctrl/Cmd+Enter submits so plain Enter keeps its newline.
  // Shortcuts target the first question with choices that has no answer yet
  // (or the first one with choices when all are answered); Escape is already
  // the dialog-wide cancel via useDialogFocus.
  useEffect(() => {
    if (submitting) return;
    const shortcutTarget = () =>
      request.questions.find(
        (entry) => (entry.choices?.length ?? 0) > 0 && (picked[entry.qid] ?? []).length === 0 && !(drafts[entry.qid] ?? "").trim(),
      ) ?? request.questions.find((entry) => (entry.choices?.length ?? 0) > 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      const typing =
        !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        if (hasAnyAnswer) {
          event.preventDefault();
          submit();
        }
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Enter") {
        if (hasAnyAnswer) {
          event.preventDefault();
          submit();
        }
        return;
      }
      if (/^[a-zA-Z]$/.test(event.key)) {
        const target = shortcutTarget();
        if (!target?.choices?.length) return;
        const index = event.key.toLowerCase().charCodeAt(0) - 97;
        // The trailing letter jumps into the free-text field instead of a
        // choice, mirroring Hermes desktop's "Other" row.
        if (index < 0 || index > target.choices.length) return;
        event.preventDefault();
        if (index === target.choices.length) {
          document.getElementById(`kana-clarify-${target.qid}`)?.focus();
        } else {
          toggleChoice(target.qid, target.multiSelect, target.choices[index]);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b-[3px] border-dotted border-line-strong px-5 pt-4 pb-3.5">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-strong"
        >
          <BotIcon className="size-5" />
        </span>
        <h2 id="agent-input-title" className="min-w-0 text-base font-extrabold break-words text-ink">
          {single ? copy.questionTitle : copy.questionsTitle(request.questions.length)}
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {request.questions.map((entry, index) => {
          const selected = picked[entry.qid] ?? [];
          const choices = entry.choices ?? [];
          return (
            <div
              key={entry.qid}
              className={index === 0 ? undefined : "mt-4 border-t-[3px] border-dotted border-line-strong pt-4"}
            >
              <div className="flex items-start gap-2.5">
                {single ? null : (
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-extrabold text-on-accent"
                  >
                    {index + 1}
                  </span>
                )}
                <p className="min-w-0 text-[13px] leading-relaxed font-bold break-words text-ink">
                  {entry.question}
                </p>
              </div>
              {entry.multiSelect && choices.length ? (
                <p className="mt-1.5 text-[10.5px] font-bold text-muted">{copy.multiHint}</p>
              ) : null}
              {choices.length ? (
                /* One full-width row per answer, like a console menu: the
                   shortcut key cap on the left, the answer in the middle, and
                   the pick disc on the right. */
                <div
                  aria-label={entry.question}
                  className="mt-3 grid gap-2.5"
                  role={entry.multiSelect ? "group" : "radiogroup"}
                >
                  {choices.map((choice, choiceIndex) => {
                    const active = selected.includes(choice);
                    const shortcut = String.fromCharCode(97 + choiceIndex).toUpperCase();
                    return (
                      <button
                        aria-checked={active}
                        aria-keyshortcuts={shortcut.toLowerCase()}
                        className={`kana-focus kana-choice flex min-h-12 w-full items-center gap-3 rounded-[20px] px-3 py-2 text-left ${active ? "is-selected" : ""}`}
                        disabled={submitting}
                        key={choice}
                        onClick={() => toggleChoice(entry.qid, entry.multiSelect, choice)}
                        role={entry.multiSelect ? "checkbox" : "radio"}
                        title={`Shortcut: ${shortcut}`}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${
                            active ? "bg-accent text-on-accent" : "bg-surface-strong text-muted"
                          }`}
                        >
                          {shortcut}
                        </span>
                        <span className="min-w-0 flex-1 text-[13px] leading-snug font-semibold text-ink">
                          {choice}
                        </span>
                        {active ? (
                          <span aria-hidden="true" className="kana-check is-inline">
                            <CheckIcon className="size-3.5" />
                          </span>
                        ) : (
                          <span
                            aria-hidden="true"
                            className="size-6 shrink-0 rounded-full border-[3px] border-line-strong"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-[10px] font-extrabold tracking-[0.14em] text-muted uppercase">
                  {copy.answerLabel}
                </span>
                <textarea
                  autoFocus={index === 0}
                  disabled={submitting}
                  id={`kana-clarify-${entry.qid}`}
                  onChange={(event) => editDraft(entry.qid, event.target.value)}
                  placeholder={copy.answerPlaceholder}
                  rows={single ? 3 : 2}
                  value={drafts[entry.qid] ?? ""}
                  className={`${inputBase} resize-y`}
                />
              </label>
            </div>
          );
        })}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t-[3px] border-dotted border-line-strong px-5 pt-3.5 pb-4">
        <button type="button" className={btnSecondary} disabled={submitting} onClick={onCancel}>
          {copy.skip}
        </button>
        <button type="submit" className={btnPrimary} disabled={submitting || !hasAnyAnswer}>
          {single ? copy.sendAnswer : copy.sendAnswers}
        </button>
      </footer>
    </form>
  );
}

export function AgentInputDialog({  request,
  submitting,
  onRespond,
  locale,
}: AgentInputDialogProps) {
  const copy = getCopy(locale).agentInput;
  const secureInputRef = useRef<HTMLInputElement | null>(null);
  const clarification = request.kind === "clarification" ? request : null;
  // Per-question state. Picking a choice and typing are mutually exclusive
  // answers for that question; answers already locked before a reconnect
  // replay prefill the dialog so earlier work is not lost.
  const [picked, setPicked] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const entry of clarification?.questions ?? []) {
      const locked = clarification?.lockedAnswers?.[entry.qid];
      if (typeof locked !== "string" || !locked) continue;
      if (entry.multiSelect) {
        try {
          const parsed: unknown = JSON.parse(locked);
          if (Array.isArray(parsed)) {
            const list = parsed.filter((item): item is string => typeof item === "string");
            if (list.length) initial[entry.qid] = list;
            continue;
          }
        } catch {
          /* plain text stays in the draft below */
        }
      }
      if (!entry.multiSelect) {
        // Single-select locks prefill as the picked choice when it matches
        // one of the offered choices, else as free text.
        if (entry.choices?.includes(locked)) {
          initial[entry.qid] = [locked];
          continue;
        }
      }
    }
    return initial;
  });
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const entry of clarification?.questions ?? []) {
      initial[entry.qid] = "";
    }
    for (const entry of clarification?.questions ?? []) {
      const locked = clarification?.lockedAnswers?.[entry.qid];
      if (typeof locked !== "string" || !locked) continue;
      if (picked[entry.qid]?.length) continue;
      if (entry.multiSelect) {
        try {
          const parsed: unknown = JSON.parse(locked);
          if (Array.isArray(parsed)) continue;
        } catch {
          /* fall through */
        }
      } else if (entry.choices?.includes(locked)) {
        continue;
      }
      initial[entry.qid] = locked;
    }
    return initial;
  });

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
        answers: [],
        cancelled: true,
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
  // A clarify call gets its own shell: a square panel whose header and footer
  // stay put while the questions scroll between them, so Send is always in
  // reach on a five-question form. The other kinds keep the plain card.
  const shellClass =
    request.kind === "clarification"
      ? "flex max-h-[calc(100dvh-1.5rem)] w-[min(560px,100%)] flex-col overflow-hidden border-2 border-line bg-bg"
      : "max-h-[calc(100dvh-1.5rem)] w-[min(480px,100%)] overflow-y-auto border-2 border-line bg-bg p-4";
  const { dialogRef, onDialogKeyDown } = useDialogFocus(() => {
    void cancel();
  }, { initialFocus: request.kind === "approval" ? "dialog" : "first" });
  const [armed, setArmed] = useState(request.kind !== "approval");
  useEffect(() => {
    if (armed) return;
    const timer = window.setTimeout(() => setArmed(true), APPROVAL_ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const command = useMemo(
    () => (request.kind === "approval" && request.command ? revealCommand(request.command) : []),
    [request],
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/85 p-3"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void cancel();
      }}
    >
      <section
        className={`${shellClass} outline-none`}
        ref={dialogRef}
        tabIndex={-1}
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
                <h2 id="agent-input-title" className="text-sm font-bold text-ink">{copy.approvalTitle}</h2>
                <p className="mt-0.5 text-xs leading-relaxed break-words text-ink-dim">{request.description}</p>
              </div>
            </div>
            {command.length ? (
              <>
                {/* Wrapped, never scrolled sideways: every part of the command is in view. */}
                <pre className="mb-2 rounded-2xl border border-line bg-surface p-3 font-mono text-xs break-all whitespace-pre-wrap text-accent-strong">
                  {command.map((segment, index) =>
                    segment.type === "text" ? (
                      segment.text
                    ) : (
                      <span key={index} className="mx-0.5 rounded bg-danger/15 px-1 font-sans font-semibold text-danger">
                        {segment.label}
                      </span>
                    ),
                  )}
                </pre>
                {command.some((segment) => segment.type === "hidden") ? (
                  <p className="mb-2 rounded-2xl border border-danger/40 px-3.5 py-2.5 text-xs font-semibold text-danger">
                    {copy.hiddenCharacters}
                  </p>
                ) : null}
              </>
            ) : null}
            {request.smartDenied ? (
              <p className="mb-2 rounded-2xl border border-danger/40 px-3.5 py-2.5 text-xs font-semibold text-danger">
                {copy.smartDenied}
              </p>
            ) : null}
            <div className={`flex flex-wrap gap-2 ${bentoCard}`}>
              {approvalChoices.map((choice) => (
                <button
                  className={choice === "deny" ? btnSecondary : `${btnPrimary} grow`}
                  disabled={submitting || (!armed && choice !== "deny")}
                  key={choice}
                  onClick={() => void onRespond({ kind: "approval", choice })}
                  type="button"
                >
                  {approvalLabel(choice, copy)}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {request.kind === "clarification" ? (
          <ClarificationForm
            request={request}
            drafts={drafts}
            picked={picked}
            setDrafts={setDrafts}
            setPicked={setPicked}
            submitting={submitting}
            onRespond={onRespond}
            onCancel={() => void cancel()}
            copy={copy}
          />
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
                    ? copy.sudoTitle
                    : request.envVar || copy.secretTitle}
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">
                  {request.kind === "sudo"
                    ? copy.sudoBody
                    : request.prompt || copy.secretBody}
                </p>
              </div>
            </div>
            <label className={`mb-2 flex flex-col gap-1.5 ${bentoCard}`}>
              <span className="text-[11px] font-semibold text-muted">
                {request.kind === "sudo" ? copy.password : copy.secretValue}
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
                {copy.secureHint}
              </span>
            </label>
            <div className={`flex justify-end gap-2 ${bentoCard}`}>
              <button type="button" className={btnSecondary} disabled={submitting} onClick={() => void cancel()}>
                {copy.cancel}
              </button>
              <button type="submit" className={btnPrimary} disabled={submitting}>
                {submitting ? copy.sending : copy.sendSecurely}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
