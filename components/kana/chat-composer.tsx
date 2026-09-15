"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  AttachmentUploadError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENTS,
  readAttachment,
  type AgentAttachment,
} from "@/lib/agent/attachments";
import { isVoiceActive } from "@/lib/store/voice-store";
import { getCopy, type Copy } from "@/lib/ui/copy";
import { ComposerDictation } from "./composer-dictation";
import { ComposerModelChoice } from "./composer-model-choice";
import { PlusIcon, ReturnIcon } from "./icons";
import { useKanaStore, useKanaWorkspace } from "./kana-workspace-context";
import { SlashCommandMenu } from "./slash-command-menu";

const MIB = 1024 * 1024;
const NO_FILES: File[] = [];
/** Commands Hermes accepts while a turn is still running. */
const BUSY_COMMANDS = ["approve", "deny", "queue", "steer", "status", "agents", "goal", "heartbeat", "background"];

function destructiveCommandPrompt(input: string, copy: Copy["workspace"]): string | null {
  const normalized = input.trim().toLowerCase().replace(/^\/+/, "");
  if (normalized === "new" || normalized.startsWith("new ")) return copy.confirmNew;
  if (normalized === "undo" || normalized.startsWith("undo ")) return copy.confirmUndo;
  if (normalized === "restart" || normalized.startsWith("restart ")) return copy.confirmRestart;
  if (normalized === "update" || normalized.startsWith("update ")) return copy.confirmUpdate;
  if (/^rollback\s+(restore|rewind)\b/.test(normalized)) return copy.confirmRollback;
  return null;
}

export function ChatComposer() {
  const workspace = useKanaWorkspace();
  const { actions } = workspace;
  const setWorkspace = workspace.stores.workspace.setState;
  const locale = useKanaStore("preferences", (state) => state.preferences.uiLocale);
  const activeConversationId = useKanaStore("conversations", (state) => state.activeConversationId ?? undefined);
  const busy = useKanaStore("agentSession", (state) => state.busy);
  const connected = useKanaStore("agentSession", (state) => state.connectionState === "connected");
  const voiceActive = useKanaStore("voice", (state) => isVoiceActive(state.runtimeState));
  const error = useKanaStore("errors", (state) => state.error);
  const suggestions = useKanaStore("commands", (state) => state.suggestions);
  const suggestionsLoading = useKanaStore("commands", (state) => state.loading);
  const message = useKanaStore("workspace", (state) =>
    activeConversationId ? (state.drafts[activeConversationId] ?? "") : "",
  );
  const files = useKanaStore("workspace", (state) =>
    activeConversationId ? (state.fileDrafts[activeConversationId] ?? NO_FILES) : NO_FILES,
  );
  const composerNotice = useKanaStore("workspace", (state) => state.composerNotice);
  const dictating = useKanaStore("workspace", (state) => state.dictating);
  const submitting = useKanaStore("workspace", (state) => state.submitting);
  const selectedCommandIndex = useKanaStore("workspace", (state) => state.selectedCommandIndex);
  const modelCatalog = useKanaStore("models", (state) => state.entry?.catalog ?? null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copy = getCopy(locale);
  const text = copy.workspace;

  const setMessage = (value: string) => {
    if (activeConversationId) workspace.stores.workspace.getState().setDraft(activeConversationId, value);
  };
  const setFiles = (next: File[]) => {
    if (activeConversationId) workspace.stores.workspace.getState().setFileDraft(activeConversationId, next);
  };
  const setNotice = (composerNotice: string) => setWorkspace({ composerNotice });

  useEffect(() => {
    queueMicrotask(() => setWorkspace({ composerNotice: "" }));
  }, [activeConversationId, setWorkspace]);

  // Slash completion follows the draft, debounced so typing stays responsive.
  useEffect(() => {
    if (!message.startsWith("/")) {
      actions.clearCommandSuggestions();
      return;
    }
    const timer = window.setTimeout(() => void actions.completeCommands(message), 120);
    return () => window.clearTimeout(timer);
  }, [actions, message]);

  const commandName = /^\/([^\s/]+)/.exec(message.trim())?.[1]?.toLowerCase();
  const canSubmitWhileBusy = Boolean(commandName && BUSY_COMMANDS.includes(commandName.replaceAll("_", "-")));
  const activeCommandIndex = Math.min(selectedCommandIndex, Math.max(0, suggestions.length - 1));
  const highlightCommand = useCallback(
    (index: number) => setWorkspace({ selectedCommandIndex: index }),
    [setWorkspace],
  );
  const selectCommand = useCallback(
    (command: string) => {
      if (activeConversationId) workspace.stores.workspace.getState().setDraft(activeConversationId, `${command} `);
      actions.clearCommandSuggestions();
    },
    [actions, activeConversationId, workspace],
  );

  const submitMessage = async () => {
    const draft = message.trim() || (files.length ? copy.composer.reviewAttachments : "");
    const state = workspace.stores.workspace.getState();
    if (!draft || state.submitting || state.dictating) return;
    if (files.length && (busy || commandName)) {
      setNotice(copy.composer.filesNeedRegularMessage);
      return;
    }
    // Prime Web Audio while Send/Enter still owns a user gesture; the audio
    // arrives too late to unlock autoplay on stricter mobile browsers.
    if (workspace.preferences.current().voiceEnabled) actions.unlockVoice();
    const confirmation = destructiveCommandPrompt(draft, text);
    if (confirmation && !window.confirm(confirmation)) return;
    setWorkspace({ submitting: true, composerNotice: "" });
    try {
      let attachments: AgentAttachment[];
      try {
        attachments = await Promise.all(files.map(readAttachment));
      } catch (readError) {
        // Nothing reached Hermes: keep the draft and the files.
        setNotice(readError instanceof Error ? readError.message : copy.status.sendFailed);
        return;
      }
      try {
        const prefill = await actions.send(draft, attachments);
        setMessage(prefill || "");
        setFiles([]);
      } catch (sendError) {
        if (sendError instanceof AttachmentUploadError) {
          // No prompt was submitted and the user message was removed, so the
          // draft stays for a retry.
          setNotice(sendError.message);
        } else {
          // The user message is already in the conversation and the banner
          // reports the failure; clearing the draft prevents a duplicate retry.
          setMessage("");
          setFiles([]);
        }
      }
    } finally {
      setWorkspace({ submitting: false });
    }
  };

  return (
    <div className="kana-composer-shell shrink-0 border-t px-4 pb-3 pt-2.5 max-sm:px-3 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
      {error ? (
        <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-xs">
          <p className="min-w-0 flex-1 break-words">{error}</p>
          <button type="button" onClick={actions.clearError} className="kana-focus min-h-8 shrink-0 px-2"
            aria-label={copy.composer.dismissError}>
            ×
          </button>
        </div>
      ) : null}
      <div className="relative">
        <SlashCommandMenu
          suggestions={suggestions}
          loading={suggestionsLoading}
          selectedIndex={activeCommandIndex}
          onHighlight={highlightCommand}
          onSelect={selectCommand}
          locale={locale}
        />
        <div className="kana-composer flex flex-col">
          {files.length ? <ul aria-label={copy.composer.attachments} className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto py-1">
            {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1 rounded-lg bg-white/12 pl-2 text-[11px]">
              <span className="truncate" title={file.name}>{file.name}</span>
              <span className="shrink-0 opacity-70">{Math.ceil(file.size / 1024)} KB</span>
              <button type="button" className="kana-focus size-8 shrink-0 rounded-lg hover:bg-white/12" disabled={submitting}
                aria-label={copy.composer.remove(file.name)} onClick={() => setFiles(files.filter((_, selected) => selected !== index))}>×</button>
            </li>)}
          </ul> : null}
          <textarea
            id="kana-message"
            ref={inputRef}
            value={message}
            rows={1}
            readOnly={submitting}
            placeholder={text.messagePlaceholder}
            aria-label={text.messageAria}
            className="max-h-28 min-h-11 w-full resize-none bg-transparent px-1 py-3 text-[15px] leading-snug focus:outline-none"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (suggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  highlightCommand((activeCommandIndex + 1) % suggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  highlightCommand((activeCommandIndex - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  setMessage(suggestions[activeCommandIndex]?.text ?? message);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  actions.clearCommandSuggestions();
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitMessage();
              }
            }}
          />
          {composerNotice ? <p role="status" className="mb-1 px-1 text-[11px] leading-relaxed">{composerNotice}</p> : null}
          <div className="flex items-center gap-1">
            <input ref={fileInputRef} type="file" multiple className="hidden" aria-label={copy.composer.chooseFiles}
              onChange={(event) => {
                const selected = [...files, ...Array.from(event.target.files ?? [])];
                event.target.value = "";
                if (selected.length > MAX_ATTACHMENTS || selected.some((file) => !file.size || file.size > MAX_ATTACHMENT_BYTES) || selected.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
                  setNotice(copy.composer.attachmentLimits(MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES / MIB, MAX_ATTACHMENT_TOTAL_BYTES / MIB));
                  return;
                }
                setFiles(selected);
                setNotice("");
                inputRef.current?.focus();
              }} />
            <button type="button" aria-label={copy.composer.attachFiles}
              title={copy.composer.attachFiles}
              disabled={submitting || !activeConversationId} className="kana-focus inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/12 disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}><PlusIcon className="size-5" /></button>
            <ComposerDictation key={activeConversationId} locale={locale}
              disabled={submitting || busy || voiceActive || !activeConversationId}
              onText={(spoken) => {
                if (activeConversationId) workspace.stores.workspace.getState().appendDraft(activeConversationId, spoken);
              }}
              onActive={(active) => setWorkspace({ dictating: active })}
              onNotice={setNotice} />
            <ComposerModelChoice key={`model-${activeConversationId}`} locale={locale} sessionKey={activeConversationId}
              connected={connected} disabled={busy || submitting} catalog={modelCatalog}
              onList={actions.listAgentModels} onSelect={actions.selectAgentModel} />
            {busy || voiceActive ? (
              <button
                type="button"
                aria-label={text.stop}
                className="kana-focus inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20 hover:bg-white/30"
                onClick={() => void actions.abort()}
              >
                <span aria-hidden="true" className="size-3 rounded-xs bg-current" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={text.send}
                disabled={(!message.trim() && !files.length) || submitting || dictating || (busy && !canSubmitWhileBusy)}
                className="kana-focus inline-flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void submitMessage()}
              >
                <ReturnIcon className="size-[18px]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
