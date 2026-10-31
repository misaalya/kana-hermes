import type { AgentToolKind } from "@/lib/agent/types";
import type { UiLocale } from "@/lib/ui/copy";

/**
 * Per-tool presentation for the live-chat feed.
 *
 * Every built-in Hermes tool is mapped by its exact registry name. There is no
 * pattern matching: a file tool must never become "web search" because its
 * name happens to start with "search". Unknown plugin/MCP tools fall back to
 * their kind and still show their original name in the activity row.
 *
 * The name lists mirror the installed Hermes registry (observed 2026-10-31);
 * a new upstream tool can be added to one family here without changing the
 * logic.
 */

export type ToolVariant = {
  /** Short past tense phrase shown before the tool name. */
  label: string;
  /** Running-state present-tense phrase. */
  runningLabel: string;
  /** Single text glyph identifying the family at a glance. */
  glyph: string;
  /** Pastel accent classes for the row chip (bg + text + border). */
  chipClass: string;
};

const ACCENT_CHIP = "border-accent/25 bg-accent/10 text-accent-strong";
const GENERIC_CHIP = "border-line-strong bg-surface text-muted";

const WEB: ToolVariant = { label: "searched the web with", runningLabel: "Searching the web ·", glyph: "🌐", chipClass: ACCENT_CHIP };
const FILE_SEARCH: ToolVariant = { label: "searched files via", runningLabel: "Searching files ·", glyph: "🔎", chipClass: ACCENT_CHIP };
const FILE_READ: ToolVariant = { label: "read a file via", runningLabel: "Reading a file ·", glyph: "📄", chipClass: ACCENT_CHIP };
const FILE_EDIT: ToolVariant = { label: "edited files via", runningLabel: "Editing files ·", glyph: "📝", chipClass: ACCENT_CHIP };
const SHELL: ToolVariant = { label: "ran a command in", runningLabel: "Running command ·", glyph: "⌘", chipClass: ACCENT_CHIP };
const TERMINAL_STATE: ToolVariant = { label: "managed the terminal with", runningLabel: "Managing the terminal ·", glyph: "🖥", chipClass: ACCENT_CHIP };
const MEDIA_GENERATE: ToolVariant = { label: "generated media with", runningLabel: "Generating media ·", glyph: "🎨", chipClass: ACCENT_CHIP };
const MEDIA_ANALYZE: ToolVariant = { label: "analyzed media with", runningLabel: "Analyzing media ·", glyph: "👁", chipClass: ACCENT_CHIP };
const BROWSER: ToolVariant = { label: "controlled the browser with", runningLabel: "Controlling browser ·", glyph: "🖥", chipClass: ACCENT_CHIP };
const DESKTOP: ToolVariant = { label: "used the desktop with", runningLabel: "Using the desktop ·", glyph: "🪟", chipClass: ACCENT_CHIP };
const DELEGATION: ToolVariant = { label: "delegated work to", runningLabel: "Delegating work ·", glyph: "🤝", chipClass: ACCENT_CHIP };
const TASKS: ToolVariant = { label: "updated the task board with", runningLabel: "Updating the task board ·", glyph: "🗂", chipClass: ACCENT_CHIP };
const SKILLS: ToolVariant = { label: "used the skill", runningLabel: "Using skill ·", glyph: "✨", chipClass: ACCENT_CHIP };
const CALLED: ToolVariant = { label: "called", runningLabel: "Calling ·", glyph: "🗂", chipClass: ACCENT_CHIP };
const GENERAL: ToolVariant = { label: "used", runningLabel: "Using ·", glyph: "⚙", chipClass: GENERIC_CHIP };

const TOOL_VARIANTS: Record<string, ToolVariant> = {};

function mapTools(names: readonly string[], variant: ToolVariant): void {
  for (const name of names) TOOL_VARIANTS[name] = variant;
}

mapTools(["web_search", "web_extract", "x_search", "url_safety"], WEB);
mapTools(["search_files"], FILE_SEARCH);
mapTools(["read_file"], FILE_READ);
mapTools(["write_file", "patch"], FILE_EDIT);
mapTools(["terminal", "execute_code", "process_manage"], SHELL);
mapTools(["read_terminal", "close_terminal"], TERMINAL_STATE);
mapTools(
  ["image_generate", "video_generate", "text_to_speech", "xai_video_edit", "xai_video_extend", "xai_video"],
  MEDIA_GENERATE,
);
mapTools(["vision_analyze", "video_analyze"], MEDIA_ANALYZE);
mapTools(
  [
    "browser_back",
    "browser_cdp",
    "browser_click",
    "browser_console",
    "browser_dialog",
    "browser_exec",
    "browser_get_images",
    "browser_navigate",
    "browser_press",
    "browser_scroll",
    "browser_snapshot",
    "browser_type",
    "browser_vault",
    "browser_vision",
  ],
  BROWSER,
);
mapTools(
  [
    "annotate_preview",
    "computer_use",
    "desktop_preview",
    "desktop_project",
    "drive_preview",
    "focus_pane",
    "gui_tour",
    "read_window_below",
    "set_theme",
    "show_tip",
  ],
  DESKTOP,
);
mapTools(["delegate_task", "cronjob_manage", "async_delegation"], DELEGATION);
mapTools(
  [
    "kanban_attach",
    "kanban_attach_url",
    "kanban_attachments",
    "kanban_block",
    "kanban_comment",
    "kanban_complete",
    "kanban_create",
    "kanban_heartbeat",
    "kanban_link",
    "kanban_list",
    "kanban_request_changes",
    "kanban_request_review",
    "kanban_schedule",
    "kanban_show",
    "kanban_unblock",
  ],
  TASKS,
);
mapTools(["skill_manage", "skill_view", "skills_list"], SKILLS);
mapTools(
  [
    "memory",
    "session_search",
    "todo_list",
    "send_message",
    "bot_mode",
    "discord",
    "discord_admin",
    "react_to_message",
    "feishu_doc_read",
    "feishu_drive_add_comment",
    "feishu_drive_list_comment_replies",
    "feishu_drive_list_comments",
    "feishu_drive_reply_comment",
    "yb_query_group_info",
    "yb_query_group_members",
    "yb_search_sticker",
    "yb_send_dm",
    "yb_send_sticker",
  ],
  CALLED,
);
mapTools(["clarify", "manage_catalog", "manage_connections", "setup_beat"], GENERAL);

/** Fallback when no family matches — still classified by the coarse kind. */
const KIND_FALLBACK: Record<AgentToolKind, Omit<ToolVariant, "chipClass">> = {
  command: { label: "ran a command in", runningLabel: "Running command ·", glyph: "⌘" },
  file: { label: "edited files via", runningLabel: "Editing files ·", glyph: "📝" },
  tool: { label: "used", runningLabel: "Using ·", glyph: "⚙" },
};

/** Status/input rows (no real tool) get a neutral presentation. */
const NEUTRAL_VARIANT: ToolVariant = {
  label: "event",
  runningLabel: "Waiting for input ·",
  glyph: "❢",
  chipClass: GENERIC_CHIP,
};

export function toolVariant(
  tool: string,
  kind: AgentToolKind | "status" | "input",
  locale: UiLocale = "en",
): ToolVariant {
  const localize = (variant: ToolVariant): ToolVariant => {
    if (locale !== "id") return variant;
    const labels: Record<string, [string, string]> = {
      "searched the web with": ["menelusuri web dengan", "Menelusuri web ·"],
      "searched files via": ["menelusuri berkas via", "Menelusuri berkas ·"],
      "read a file via": ["membaca berkas via", "Membaca berkas ·"],
      "ran a command in": ["menjalankan perintah di", "Menjalankan perintah ·"],
      "managed the terminal with": ["mengelola terminal dengan", "Mengelola terminal ·"],
      "edited files via": ["mengedit berkas melalui", "Mengedit berkas ·"],
      "generated media with": ["menghasilkan media dengan", "Menghasilkan media ·"],
      "analyzed media with": ["menganalisis media dengan", "Menganalisis media ·"],
      "controlled the browser with": ["mengendalikan browser dengan", "Mengendalikan browser ·"],
      "used the desktop with": ["menggunakan desktop dengan", "Menggunakan desktop ·"],
      "delegated work to": ["mendelegasikan pekerjaan kepada", "Mendelegasikan pekerjaan ·"],
      "updated the task board with": ["memperbarui papan tugas dengan", "Memperbarui papan tugas ·"],
      "used the skill": ["menggunakan keahlian", "Menggunakan keahlian ·"],
      called: ["memanggil", "Memanggil ·"],
      used: ["menggunakan", "Menggunakan ·"],
      event: ["peristiwa", "Menunggu input ·"],
    };
    const translated = labels[variant.label];
    return translated
      ? { ...variant, label: translated[0], runningLabel: translated[1] }
      : variant;
  };
  if (kind === "status" || kind === "input") return localize(NEUTRAL_VARIANT);
  const exact = TOOL_VARIANTS[tool.trim().toLowerCase()];
  if (exact) return localize(exact);
  return localize({ ...KIND_FALLBACK[kind], chipClass: GENERIC_CHIP });
}
