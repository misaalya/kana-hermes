import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogFocusOptions = {
  /**
   * "dialog" focuses the dialog itself instead of its first control, so a key
   * the user was already pressing (Enter in the composer) cannot activate a
   * button that appeared under it. The dialog element needs tabIndex={-1}.
   */
  initialFocus?: "first" | "dialog";
};

/** Traps keyboard focus inside a modal and restores the opener on unmount. */
export function useDialogFocus(onEscape?: () => void, { initialFocus = "first" }: DialogFocusOptions = {}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const escapeRef = useRef(onEscape);

  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const first = initialFocus === "dialog"
      ? dialog
      : dialog?.querySelector<HTMLElement>("[autofocus], " + FOCUSABLE);
    window.requestAnimationFrame(() => first?.focus());
    return () => {
      window.requestAnimationFrame(() => {
        // Restore only focus that left with the dialog. If something else was
        // focused in the meantime (the composer, say), taking it back would
        // send the next keystroke, even Enter, to the opener.
        const current = document.activeElement;
        if (!current || current === document.body || !current.isConnected) opener?.focus();
      });
    };
    // Focus is placed once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && escapeRef.current) {
      event.preventDefault();
      escapeRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    const current = document.activeElement;
    // Focus can rest on an element outside the Tab order (a tabIndex=-1 step
    // heading, or the dialog itself). Wrap based on its DOM position so Tab
    // never leaves the dialog from there either.
    const precedes = (element: Element) =>
      current instanceof Node && Boolean(element.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING);
    const follows = (element: Element) =>
      current instanceof Node && Boolean(element.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_PRECEDING);
    if (event.shiftKey && (current === first || !focusable.some(precedes))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !focusable.some(follows))) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, onDialogKeyDown: onKeyDown };
}
