export type KanaUnavailableCommandReason =
  | "gateway"
  | "messaging"
  | "terminal"
  | "presentation";

const UNAVAILABLE_COMMANDS = new Map<string, KanaUnavailableCommandReason>([
  // These commands depend on chat identity, topics, or an outbound messaging
  // adapter. Kana connects through hermes serve and has no fake platform ID.
  ["platform", "messaging"],
  ["set-home", "messaging"],
  ["sethome", "messaging"],
  ["start", "messaging"],
  ["topic", "messaging"],

  // These operate the separate `hermes gateway` supervisor, not the
  // independently started `hermes serve` process Kana is connected to.
  ["pause", "gateway"],
  ["restart", "gateway"],

  // These mutate or inspect terminal-only presentation state. Kana has its own
  // transcript, composer, and responsive shell instead of a hidden TUI.
  ["battery", "terminal"],
  ["busy", "terminal"],
  ["clear", "terminal"],
  ["copy", "terminal"],
  ["density", "terminal"],
  ["footer", "terminal"],
  ["focus", "terminal"],
  ["history", "terminal"],
  ["image", "terminal"],
  ["indicator", "terminal"],
  ["logs", "terminal"],
  ["mouse", "terminal"],
  ["paste", "terminal"],
  ["quit", "terminal"],
  ["redraw", "terminal"],
  ["skin", "terminal"],
  ["statusbar", "terminal"],
  ["timestamps", "terminal"],
  ["verbose", "terminal"],

  // Kana owns these presentation capabilities behind its provider settings.
  ["voice", "presentation"],
  ["wake", "presentation"],
]);

export function kanaUnavailableReason(
  command: string,
): KanaUnavailableCommandReason | null {
  const name = command
    .trim()
    .replace(/^\/+/, "")
    .split(/\s+/, 1)[0]
    ?.toLowerCase()
    .replaceAll("_", "-");
  return name ? UNAVAILABLE_COMMANDS.get(name) ?? null : null;
}

export function kanaUnavailableMessage(command: string): string | null {
  const normalized = command.trim().replace(/^\/+/, "").split(/\s+/, 1)[0];
  const name = `/${normalized || command}`;
  const reason = kanaUnavailableReason(command);
  if (reason === "messaging") {
    return `${name} needs Telegram, Discord, Slack, or another Hermes messaging identity. Kana connects through hermes serve and does not invent platform or topic metadata.`;
  }
  if (reason === "gateway") {
    return `${name} controls the separate Hermes messaging gateway. Kana is connected to hermes serve and cannot claim or restart that process.`;
  }
  if (reason === "terminal") {
    return `${name} controls Hermes terminal presentation and has no effect on Kana's web interface.`;
  }
  if (reason === "presentation") {
    return normalized.toLowerCase() === "voice"
      ? "/voice is managed in Kana Settings → Japanese voice, where Qwen3-TTS health and speakers are available."
      : "/wake is not connected to Kana yet; Kana does not claim Hermes Desktop's microphone lease.";
  }
  return null;
}
