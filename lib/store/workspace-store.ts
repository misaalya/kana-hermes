import { createStore, type StoreApi } from "zustand/vanilla";
import type { HermesRuntimeStatus } from "@/lib/runtime/hermes-control-client";

export type DependencyFindings = {
  hermes: "running" | "installed" | "missing";
  voice: "ok" | "loading" | "stopped" | "not_installed" | "unsupported" | "error" | "off" | null;
};

export type WizardMode = null | "full" | "repair";
export type ConnectPhase = "idle" | "connecting" | "auto_starting";

/** Workspace UI shared by more than one component: drafts, panels, gate, setup. */
export type WorkspaceState = {
  /** Composer text per conversation id. */
  drafts: Record<string, string>;
  /** Selected attachments per conversation id. */
  fileDrafts: Record<string, File[]>;
  composerNotice: string;
  dictating: boolean;
  submitting: boolean;
  selectedCommandIndex: number;

  settingsOpen: boolean;
  sessionsOpen: boolean;
  avatarLayoutOpen: boolean;
  /** Desktop chat panel; phones show chat unless the avatar is being positioned. */
  chatOpen: boolean;
  usesMobileChat: boolean;

  connectionGateOpen: boolean;
  connectionGateDismissed: boolean;
  /** The one automatic connection attempt of this page load has finished. */
  automaticConnectFinished: boolean;
  connectPhase: ConnectPhase;
  hermesRuntime: HermesRuntimeStatus | null;
  hermesRuntimeNotice: string | null;
  hermesRuntimeBusy: boolean;

  deps: DependencyFindings;
  wizardMode: WizardMode;

  setDraft(conversationId: string, value: string): void;
  appendDraft(conversationId: string, text: string): void;
  setFileDraft(conversationId: string, files: File[]): void;
};

export type WorkspaceStore = StoreApi<WorkspaceState>;

export function createWorkspaceStore(): WorkspaceStore {
  return createStore<WorkspaceState>()((set) => ({
    drafts: {},
    fileDrafts: {},
    composerNotice: "",
    dictating: false,
    submitting: false,
    selectedCommandIndex: 0,
    settingsOpen: false,
    sessionsOpen: false,
    avatarLayoutOpen: false,
    chatOpen: true,
    usesMobileChat: false,
    connectionGateOpen: false,
    connectionGateDismissed: false,
    automaticConnectFinished: false,
    connectPhase: "idle",
    hermesRuntime: null,
    hermesRuntimeNotice: null,
    hermesRuntimeBusy: false,
    deps: { hermes: "installed", voice: null },
    wizardMode: null,
    setDraft(conversationId, value) {
      set((state) =>
        state.drafts[conversationId] === value
          ? state
          : { drafts: { ...state.drafts, [conversationId]: value } },
      );
    },
    appendDraft(conversationId, text) {
      set((state) => ({
        drafts: {
          ...state.drafts,
          [conversationId]: [state.drafts[conversationId]?.trimEnd(), text].filter(Boolean).join(" "),
        },
      }));
    },
    setFileDraft(conversationId, files) {
      set((state) => ({ fileDrafts: { ...state.fileDrafts, [conversationId]: files } }));
    },
  }));
}
