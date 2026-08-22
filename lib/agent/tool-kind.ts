import type { AgentToolKind } from "./types";

const COMMAND_TOOL = /(terminal|shell|command|execute|bash|powershell|process)/i;
const FILE_TOOL = /(patch|file|write|edit|delete|move|copy|directory)/i;

export function classifyHermesTool(name: string): AgentToolKind {
  if (COMMAND_TOOL.test(name)) {
    return "command";
  }
  if (FILE_TOOL.test(name)) {
    return "file";
  }
  return "tool";
}

