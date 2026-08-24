import type { AgentToolKind } from "@/lib/agent/types";

/**
 * Per-tool-family presentation variants for the live-chat feed.
 *
 * The gateway emits raw Hermes tool names (web_search, terminal, patch,
 * image_generation, delegate, …). Each family gets its own verb, glyph, and
 * pastel accent so the feed reads like a vtuber stream chat — every line
 * visually distinct instead of a generic "Using X".
 *
 * Families mirror the installed hermes tool surface (tools/*.py): web research
 * (web_tools, x_search), shell work (terminal, code_execution), file edits
 * (file_tools, patch), media generation (image_generation, tts,
 * video_generation, flux3_video), browser/desktop automation (browser_*,
 * computer_use), delegation (delegate, subagent_*, cronjob), skills
 * (skill_manager, skills_*), memory/session (session_search, todo).
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

const WEB_CHIP = "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300";
const SHELL_CHIP = "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300";
const FILE_CHIP = "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300";
const MEDIA_CHIP = "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900 dark:bg-fuchsia-950/60 dark:text-fuchsia-300";
const BROWSER_CHIP = "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300";
const AGENT_CHIP = "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-300";
const SKILL_CHIP = "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300";
const MEMORY_CHIP = "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300";
const GENERIC_CHIP = "border-line-strong bg-surface text-muted";

type FamilyRule = {
  match: RegExp;
  variant: Omit<ToolVariant, "chipClass"> & { chipClass: string };
};

const FAMILY_RULES: FamilyRule[] = [
  {
    // Web research: web_tools, x_search, url_safety, transcription of pages.
    match: /^(web_|x_search|url_safety|search)/i,
    variant: { label: "searched the web with", runningLabel: "Searching the web ·", glyph: "🌐", chipClass: WEB_CHIP },
  },
  {
    // Shell / code execution.
    match: /^(terminal|shell|code_execution|bash|command|process|env_probe)/i,
    variant: { label: "ran a command in", runningLabel: "Running command ·", glyph: "⌘", chipClass: SHELL_CHIP },
  },
  {
    // File operations.
    match: /(file|patch|edit|write|directory|checkpoint|working_diff)/i,
    variant: { label: "edited files via", runningLabel: "Editing files ·", glyph: "📝", chipClass: FILE_CHIP },
  },
  {
    // Media generation: images, speech, video.
    match: /^(image_generation|tts|video_generation|flux3|xai_video|transcription|vision)/i,
    variant: { label: "generated media with", runningLabel: "Generating media ·", glyph: "🎨", chipClass: MEDIA_CHIP },
  },
  {
    // Browser / desktop automation.
    match: /^(browser|computer_use|drive_preview|desktop_ui|annotate_preview|apply_layout|focus_pane)/i,
    variant: { label: "controlled the browser with", runningLabel: "Controlling browser ·", glyph: "🖥", chipClass: BROWSER_CHIP },
  },
  {
    // Delegation & scheduling.
    match: /^(delegate|subagent|async_delegation|cronjob|kanban|interrupt)/i,
    variant: { label: "delegated work to", runningLabel: "Delegating work ·", glyph: "🤝", chipClass: AGENT_CHIP },
  },
  {
    // Skills.
    match: /^skill/i,
    variant: { label: "used the skill", runningLabel: "Using skill ·", glyph: "✨", chipClass: SKILL_CHIP },
  },
  {
    // Memory / session / messaging tools.
    match: /^(session_search|todo|memory|send_message|bot_mode|discord|feishu|homeassistant|mcp)/i,
    variant: { label: "called", runningLabel: "Calling ·", glyph: "🗂", chipClass: MEMORY_CHIP },
  },
];

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
): ToolVariant {
  if (kind === "status" || kind === "input") return NEUTRAL_VARIANT;
  const rule = FAMILY_RULES.find((entry) => entry.match.test(tool));
  if (rule) return rule.variant;
  return { ...KIND_FALLBACK[kind], chipClass: GENERIC_CHIP };
}
