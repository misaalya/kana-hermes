/**
 * An approval shows the command Hermes wants to run, and the user decides from
 * what they see. A command can hide part of itself from that reader: a long
 * run of spaces or blank lines pushes the rest out of sight, and invisible or
 * bidirectional-control characters (the "Trojan Source" trick) hide or reorder
 * text. The approval dialog shows each of these as a visible marker instead.
 */
export type CommandSegment =
  | { type: "text"; text: string }
  | { type: "hidden"; label: string };

/** Longer than any alignment a real command needs. */
const MIN_BLANK_RUN = 16;
/** Three or more blank lines in a row. */
const MIN_NEWLINE_RUN = 4;
const MAX_LISTED_CODES = 3;

// Characters that draw nothing or change how the text around them is drawn:
// C0/C1 controls other than tab and newline (carriage return included), soft
// hyphen, zero-width and bidi controls, word joiners, the BOM, interlinear
// annotation, variation selectors, and Unicode tag characters.
const INVISIBLE =
  "\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u115F\\u1160\\u180E\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF9-\\uFFFB\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}";
const SUSPICIOUS = new RegExp(`[ \\t]{${MIN_BLANK_RUN},}|\\n{${MIN_NEWLINE_RUN},}|[${INVISIBLE}]+`, "gu");

function codePointLabel(run: string): string {
  const codes = [...run].map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  return codes.length <= MAX_LISTED_CODES
    ? codes.join(" ")
    : `${codes.slice(0, MAX_LISTED_CODES).join(" ")} …+${codes.length - MAX_LISTED_CODES}`;
}

export function revealCommand(command: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let cursor = 0;
  for (const match of command.matchAll(SUSPICIOUS)) {
    if (match.index > cursor) segments.push({ type: "text", text: command.slice(cursor, match.index) });
    const run = match[0];
    if (run[0] === " " || run[0] === "\t") {
      segments.push({ type: "hidden", label: `␣×${run.length}` });
    } else if (run[0] === "\n") {
      segments.push({ type: "text", text: "\n" }, { type: "hidden", label: `↵×${run.length}` }, { type: "text", text: "\n" });
    } else {
      segments.push({ type: "hidden", label: codePointLabel(run) });
    }
    cursor = match.index + run.length;
  }
  if (cursor < command.length) segments.push({ type: "text", text: command.slice(cursor) });
  return segments;
}
