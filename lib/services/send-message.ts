import { AttachmentUploadError, type AgentAttachment } from "@/lib/agent/attachments";
import {
  createSystemMessage,
  createUserMessage,
  withoutLastUserTurn,
} from "@/lib/conversation/hermes-transcript";
import type { KanaStores } from "@/lib/store/kana-stores";
import { getCopy } from "@/lib/ui/copy";
import { statusCopy } from "./agent-event-handlers";
import { isFreshConversation, type ConversationService } from "./conversation-service";
import type { HermesSessionManager } from "./hermes-session-manager";
import type { ModelCatalogService } from "./model-catalog-service";
import type { PreferencesAccess } from "./preferences-service";
import type { HermesControl } from "./workspace-setup";

export type SendMessageDependencies = {
  stores: KanaStores;
  conversations: ConversationService;
  sessions: HermesSessionManager;
  preferences: PreferencesAccess;
  models: Pick<ModelCatalogService, "invalidate">;
  /** The hermes serve process Kana runs; /restart restarts it. */
  hermes?: Pick<HermesControl, "inspect" | "start">;
};

export function shortTitle(text: string): string {
  const title = text.replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 42)}…` : title;
}

/**
 * Send what the user typed in the active conversation: a prompt, a Kana
 * command (/new, /sessions, /resume, /restart), or a Hermes slash command.
 * Resolves to a draft when a command prefills the composer.
 */
export async function sendMessage(
  deps: SendMessageDependencies,
  text: string,
  attachments: AgentAttachment[] = [],
): Promise<string | void> {
  const { stores, conversations, sessions, preferences, models } = deps;
  const session = stores.agentSession;
  const setStatus = (status: string) => session.setState({ status });
  const status = () => statusCopy(preferences.current().uiLocale);
  const clearSuggestions = () => stores.commands.setState({ suggestions: [] });

  const cleanText = text.trim();
  const displayText = attachments.length
    ? `${cleanText}\n\n[Attached files: ${attachments.map((file) => file.name).join(", ")}]`
    : cleanText;
  const commandMatch = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(cleanText);
  const commandName = commandMatch?.[1]?.toLowerCase().replaceAll("_", "-");
  const commandArg = commandMatch?.[2]?.trim() || "";
  const activeConversationId = stores.conversations.getState().activeConversationId;
  if (!cleanText || !activeConversationId) return;
  const wasBusy = session.getState().busy;
  if (attachments.length && (wasBusy || commandName)) {
    // Nothing was saved or submitted yet, so the composer keeps the draft.
    throw new AttachmentUploadError(
      new Error("Send attachments with a regular message after the current turn finishes."),
    );
  }

  const conversation = conversations.get(activeConversationId);
  if (!conversation) return;

  // A plain message typed mid-turn is queued and submitted when the turn
  // completes instead of being dropped.
  if (wasBusy && !commandName) {
    sessions.client?.enqueuePrompt(cleanText);
    conversations.save({
      ...conversation,
      messages: [...conversation.messages, { ...createUserMessage(cleanText), text: cleanText }],
    });
    setStatus(status().queued);
    return;
  }

  if (commandName === "new") {
    if (isFreshConversation(conversation)) {
      // Reuse the blank conversation; an explicit title still applies to it.
      if (commandArg) conversations.save({ ...conversation, title: commandArg, titleChosen: true });
      stores.activity.getState().reset();
      setStatus(status().alreadyNew);
      clearSuggestions();
      return;
    }
    const next = conversations.save({
      ...conversations.create({ title: commandArg }),
      messages: [
        createUserMessage(cleanText),
        createSystemMessage("Fresh Kana conversation created on a new Hermes session.", cleanText),
      ],
    });
    conversations.activate(next);
    sessions.forgetOpenedSession();
    // Like the New moment button: a new Hermes session, on Hermes's default model.
    await sessions.openActiveSession();
    setStatus(status().newReady);
    clearSuggestions();
    return;
  }

  if (commandName === "sessions" || commandName === "resume") {
    if (commandName === "resume" && commandArg) {
      const needle = commandArg.toLowerCase();
      const target = conversations
        .all()
        .find(
          (item) =>
            item.id.toLowerCase().startsWith(needle) ||
            item.title.toLowerCase() === needle ||
            item.title.toLowerCase().includes(needle),
        );
      if (target) {
        conversations.activate(target);
        sessions.forgetOpenedSession();
        setStatus(getCopy(preferences.current().uiLocale).agentStatus.resumed(target.title));
        clearSuggestions();
        return;
      }
    }
    const listing = conversations
      .all()
      .map((item, index) => `${index + 1}. ${item.title} — ${item.id.slice(0, 18)}`)
      .join("\n");
    conversations.save({
      ...conversation,
      messages: [
        ...conversation.messages,
        createUserMessage(cleanText),
        createSystemMessage(
          `${listing || "No Kana conversations found."}\n\nUse /resume <title or id> to switch.`,
          cleanText,
        ),
      ],
    });
    clearSuggestions();
    return;
  }

  // Hermes's own /restart restarts its messaging gateway. In Kana it restarts
  // the hermes serve Kana is connected to, for what Hermes reads only at
  // startup, then resumes this conversation's session on the new process.
  if (commandName === "restart") {
    const copy = getCopy(preferences.current().uiLocale).slash;
    const note = (output: string) => {
      const latest = conversations.get(conversation.id) ?? conversation;
      conversations.save({ ...latest, messages: [...latest.messages, createSystemMessage(output, cleanText)] });
    };
    clearSuggestions();
    conversations.save({ ...conversation, messages: [...conversation.messages, createUserMessage(cleanText)] });
    // Hermes drains running turns before it restarts; Kana waits for its own.
    if (wasBusy) {
      note(copy.restartBusy);
      return;
    }
    session.setState({ busy: true, status: status().restarting });
    try {
      const hermes = deps.hermes;
      if (!hermes || !(await hermes.inspect()).managed) {
        note(copy.restartNotManaged);
        return;
      }
      await hermes.start({ restart: true });
      note((await sessions.reconnect()) ? copy.restarted : copy.restartReconnecting);
    } catch (error) {
      note(copy.restartFailed(error instanceof Error ? error.message : String(error)));
    } finally {
      session.setState({ busy: false, status: status().commandComplete });
    }
    return;
  }

  session.setState({ busy: true, status: status().opening });

  const pendingUserMessage = createUserMessage(displayText);
  const nextConversation = conversations.save({
    ...conversation,
    title:
      conversation.messages.length === 0 && conversation.title === "New conversation"
        ? shortTitle(cleanText)
        : conversation.title,
    messages: [...conversation.messages, pendingUserMessage],
  });

  sessions.tracking.turnId = nextConversation.id;
  try {
    const agent = await sessions.ensure(nextConversation);
    if (commandName) {
      const result = await agent.executeCommand({ command: cleanText });
      // /model changes the session's model, and /reload can add providers with
      // new keys: the cached catalog is out of date either way.
      if (commandName === "model" || commandName === "reload") models.invalidate();
      // Opening the session linked it to the conversation; saving the snapshot
      // taken before that would drop the link.
      const opened = conversations.get(nextConversation.id) ?? nextConversation;

      if (result.type === "output") {
        if ((commandName === "approve" || commandName === "deny") && session.getState().pendingInput?.kind === "approval") {
          session.setState({ pendingInput: null });
        }
        const output = result.warning ? `Warning: ${result.warning}\n${result.output}` : result.output;
        const titled = commandName === "title" && commandArg ? { ...opened, title: commandArg } : opened;
        conversations.save({ ...titled, messages: [...titled.messages, createSystemMessage(output, cleanText)] });
        if (!wasBusy) {
          session.setState({ busy: false, status: status().commandComplete });
          sessions.tracking.turnId = null;
        } else {
          setStatus(status().continuing);
        }
      } else if (result.type === "session") {
        const savedBranch = conversations.save({
          ...conversations.create({ title: result.title }),
          messages: [...nextConversation.messages, createSystemMessage(result.output, cleanText)],
          agent: {
            provider: "hermes",
            persistentSessionId: result.session.persistentSessionId,
            status: "linked",
            relationship: "branch",
            parentConversationId: nextConversation.id,
          },
        });
        conversations.activate(savedBranch);
        sessions.tracking.openedId = savedBranch.id;
        sessions.tracking.turnId = null;
        session.setState({
          busy: false,
          status: getCopy(preferences.current().uiLocale).agentStatus.branched(savedBranch.title),
        });
      } else if (result.type === "prefill") {
        if (result.notice) {
          const baseMessages =
            commandName === "undo"
              ? [...withoutLastUserTurn(conversation.messages), createUserMessage(cleanText)]
              : opened.messages;
          conversations.save({
            ...opened,
            messages: [...baseMessages, createSystemMessage(result.notice, cleanText)],
          });
        }
        if (!wasBusy) session.setState({ busy: false });
        setStatus(status().draftReady);
        if (!wasBusy) sessions.tracking.turnId = null;
        return result.message;
      } else if (result.notice) {
        conversations.save({
          ...opened,
          messages: [...opened.messages, createSystemMessage(result.notice, cleanText)],
        });
      }
    } else {
      await agent.sendMessage({ text: displayText, attachments });
      // Hermes stored the session when it accepted the prompt, so a refresh
      // from here on resumes it, even while this first turn is still running.
      conversations.markStored(nextConversation.id);
    }
    clearSuggestions();
  } catch (sendError) {
    if (sendError instanceof AttachmentUploadError) {
      const current = conversations.get(nextConversation.id);
      if (current) {
        conversations.save({
          ...current,
          messages: current.messages.filter((item) => item.id !== pendingUserMessage.id),
        });
      }
    }
    if (!wasBusy) session.setState({ busy: false });
    setStatus(wasBusy ? status().stillWorking : status().sendFailed);
    stores.errors
      .getState()
      .report("agent", sendError instanceof Error ? sendError.message : status().sendFailed);
    if (!wasBusy) sessions.tracking.turnId = null;
    throw sendError;
  }
}
