import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { AgentToolKind } from "@/lib/agent/types";
import { classifyHermesTool } from "@/lib/agent/tool-kind";
import { toolVariant } from "@/lib/agent/tool-presets";

type Case = [tool: string, kind: AgentToolKind, label: string];

describe("Hermes tool presentation", () => {
  it("classifies the tools Hermes actually exposes by what they do", () => {
    const cases: Case[] = [
      ["web_search", "tool", "searched the web with"],
      ["web_extract", "tool", "searched the web with"],
      ["x_search", "tool", "searched the web with"],
      ["url_safety", "tool", "searched the web with"],
      ["search_files", "file", "searched files via"],
      ["read_file", "file", "read a file via"],
      ["write_file", "file", "edited files via"],
      ["patch", "file", "edited files via"],
      ["terminal", "command", "ran a command in"],
      ["execute_code", "command", "ran a command in"],
      ["process_manage", "command", "ran a command in"],
      ["read_terminal", "command", "managed the terminal with"],
      ["close_terminal", "command", "managed the terminal with"],
      ["image_generate", "tool", "generated media with"],
      ["video_generate", "tool", "generated media with"],
      ["text_to_speech", "tool", "generated media with"],
      ["vision_analyze", "tool", "analyzed media with"],
      ["video_analyze", "tool", "analyzed media with"],
      ["browser_exec", "tool", "controlled the browser with"],
      ["computer_use", "tool", "used the desktop with"],
      ["desktop_preview", "tool", "used the desktop with"],
      ["drive_preview", "tool", "used the desktop with"],
      ["focus_pane", "tool", "used the desktop with"],
      ["read_window_below", "tool", "used the desktop with"],
      ["delegate_task", "tool", "delegated work to"],
      ["cronjob_manage", "tool", "delegated work to"],
      ["kanban_create", "tool", "updated the task board with"],
      ["kanban_complete", "tool", "updated the task board with"],
      ["skill_manage", "tool", "used the skill"],
      ["skills_list", "tool", "used the skill"],
      ["session_search", "tool", "called"],
      ["send_message", "tool", "called"],
      ["yb_send_dm", "tool", "called"],
      ["manage_connections", "tool", "used"],
      ["clarify", "tool", "used"],
    ];
    for (const [tool, kind, label] of cases) {
      assert.equal(toolVariant(tool, kind, "en").label, label, tool);
    }
  });

  it("does not confuse file search with web search or file reads with edits", () => {
    assert.equal(toolVariant("search_files", "file").label, "searched files via");
    assert.notEqual(toolVariant("search_files", "file").label, "searched the web with");
    assert.equal(toolVariant("read_file", "file").label, "read a file via");
    assert.notEqual(toolVariant("read_file", "file").label, "edited files via");
    assert.equal(toolVariant("session_search", "tool").label, "called");
  });

  it("does not call media analysis media generation", () => {
    assert.equal(toolVariant("vision_analyze", "tool").label, "analyzed media with");
    assert.notEqual(toolVariant("vision_analyze", "tool").label, "generated media with");
    assert.equal(toolVariant("image_generate", "tool").label, "generated media with");
  });

  it("keeps terminal state and desktop tools out of command and browser labels", () => {
    assert.notEqual(toolVariant("read_terminal", "command").label, "ran a command in");
    assert.notEqual(toolVariant("desktop_preview", "tool").label, "controlled the browser with");
  });

  it("classifies kinds by exact registry names, not name patterns", () => {
    assert.equal(classifyHermesTool("search_files"), "file");
    assert.equal(classifyHermesTool("read_file"), "file");
    assert.equal(classifyHermesTool("read_terminal"), "command");
    assert.equal(classifyHermesTool("execute_code"), "command");
    assert.equal(classifyHermesTool("browser_exec"), "tool");
    assert.equal(classifyHermesTool("my_future_file_helper"), "tool");
  });

  it("falls back to the coarse kind for tools outside the built-in registry", () => {
    assert.equal(toolVariant("plugin_file_reader", "file").label, "edited files via");
    assert.equal(toolVariant("plugin_runner", "command").label, "ran a command in");
    assert.equal(toolVariant("plugin_tool", "tool").label, "used");
  });

  it("localizes the new families", () => {
    assert.equal(toolVariant("search_files", "file", "id").label, "menelusuri berkas via");
    assert.equal(toolVariant("read_file", "file", "id").label, "membaca berkas via");
    assert.equal(toolVariant("read_terminal", "command", "id").label, "mengelola terminal dengan");
    assert.equal(toolVariant("image_generate", "tool", "id").label, "menghasilkan media dengan");
    assert.equal(toolVariant("vision_analyze", "tool", "id").label, "menganalisis media dengan");
    assert.equal(toolVariant("desktop_preview", "tool", "id").label, "menggunakan desktop dengan");
  });

  it("gives running rows their own phrasing", () => {
    assert.equal(toolVariant("search_files", "file").runningLabel, "Searching files ·");
    assert.equal(toolVariant("read_file", "file").runningLabel, "Reading a file ·");
    assert.equal(toolVariant("vision_analyze", "tool").runningLabel, "Analyzing media ·");
    assert.equal(toolVariant("image_generate", "tool").runningLabel, "Generating media ·");
  });
});
