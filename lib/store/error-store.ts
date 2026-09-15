import { createStore, type StoreApi } from "zustand/vanilla";
import { classifyKanaError } from "@/lib/diagnostics/safe-diagnostics";
import type {
  KanaErrorCategory,
  KanaErrorRecord,
  KanaErrorSource,
  KanaRuntimeMetrics,
} from "@/lib/diagnostics/types";

export type ReportError = (
  source: KanaErrorSource,
  value: unknown,
  category?: KanaErrorCategory,
) => KanaErrorRecord | null;

export type ErrorState = {
  /** Message shown in the composer banner until dismissed. */
  error: string | null;
  /** Last classified failure, kept for diagnostics after dismissal. */
  lastError: KanaErrorRecord | null;
  /** The last reported message; the same message is not reported twice in a row. */
  lastMessage: string | null;
  metrics: KanaRuntimeMetrics;
  report: ReportError;
  /** Record a failure for diagnostics without showing the banner. */
  record(record: KanaErrorRecord): void;
  /** Close the banner without forgetting diagnostics. */
  dismiss(): void;
  /** Close the banner and allow the same message to be reported again. */
  clear(): void;
  accumulateMetrics(partial: Partial<KanaRuntimeMetrics>): void;
};

export type ErrorStore = StoreApi<ErrorState>;

export function createErrorStore(): ErrorStore {
  return createStore<ErrorState>()((set, get) => ({
    error: null,
    lastError: null,
    lastMessage: null,
    metrics: { reconnectCount: 0 },
    report(source, value, category) {
      const message =
        value instanceof Error
          ? value.message
          : typeof value === "string"
            ? value
            : "Something went wrong.";
      if (get().lastMessage === message) return null;
      const record = classifyKanaError(value, source, category);
      set({ lastMessage: message, lastError: record, error: record.message });
      return record;
    },
    record(record) {
      set({ lastError: record });
    },
    dismiss() {
      set({ error: null });
    },
    clear() {
      set({ error: null, lastMessage: null });
    },
    accumulateMetrics(partial) {
      set((state) => ({ metrics: { ...state.metrics, ...partial } }));
    },
  }));
}
