import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBraveBrowser } from "../../lib/voice/brave-browser";

describe("isBraveBrowser", () => {
  it("detects Brave through navigator.brave", async () => {
    const brave = { brave: { isBrave: async () => true } } as unknown as Navigator;
    assert.equal(await isBraveBrowser(brave), true);
  });

  it("treats other browsers and failing probes as not Brave", async () => {
    assert.equal(await isBraveBrowser({} as Navigator), false);
    const failing = { brave: { isBrave: async () => { throw new Error("blocked"); } } } as unknown as Navigator;
    assert.equal(await isBraveBrowser(failing), false);
  });
});
