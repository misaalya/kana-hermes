import type { AgentToolKind } from "./types";

// Exact Hermes tool names, never name patterns: search_files is a file tool,
// and a future tool whose name merely contains "file" must not inherit it.
const COMMAND_TOOLS = new Set([
  "terminal",
  "execute_code",
  "process_manage",
  "read_terminal",
  "close_terminal",
]);

const FILE_TOOLS = new Set([
  "search_files",
  "read_file",
  "write_file",
  "patch",
]);

export function classifyHermesTool(name: string): AgentToolKind {
  const key = name.trim().toLowerCase();
  if (COMMAND_TOOLS.has(key)) return "command";
  if (FILE_TOOLS.has(key)) return "file";
  return "tool";
}
