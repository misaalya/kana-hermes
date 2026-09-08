import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { resolveVoiceForSynthesis } from "@/lib/server/voice-library";
import { getDefaultVoiceClone } from "@/lib/server/voice-store";

const root = mkdtempSync(path.join(tmpdir(), "kana-voice-library-test-"));
const previousDataDir = process.env.KANA_DATA_DIR;
process.env.KANA_DATA_DIR = root;

const originalFetch = globalThis.fetch;

before(() => {
  process.env.KANA_DATA_DIR = root;
});

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
});

after(() => {
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

describe("Kana voice library registration", () => {
  it("registers the bundled default from the API v2 response before first synthesis", async () => {
    const requests: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${String(input)}`);
        if ((init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({
            default_voice_id: "",
            supports_voice_clone: true,
            voices: [],
          }), { headers: { "Content-Type": "application/json" } });
        }
        const body = JSON.parse(String(init?.body)) as { audio_base64?: string };
        assert.ok((body.audio_base64?.length ?? 0) > 100);
        return new Response(JSON.stringify({
          voice: { id: "clone-11111111111111111111111111111111" },
        }), { headers: { "Content-Type": "application/json" } });
      },
    });

    const voiceId = await resolveVoiceForSynthesis(17860);
    assert.equal(voiceId, "clone-11111111111111111111111111111111");
    assert.equal(getDefaultVoiceClone()?.service_voice_id, voiceId);
    assert.deepEqual(requests.map((entry) => entry.split(" ", 1)[0]), ["GET", "POST"]);
  });

  it("re-registers the original reference when service-side profiles were wiped", async () => {
    const stored = getDefaultVoiceClone();
    assert.ok(stored);
    assert.ok(readFileSync(stored.file_path).byteLength > 0);
    let registrations = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (_input: string | URL | Request, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({
            default_voice_id: "",
            supports_voice_clone: true,
            voices: [],
          }), { headers: { "Content-Type": "application/json" } });
        }
        registrations += 1;
        return new Response(JSON.stringify({
          voice: { id: "clone-22222222222222222222222222222222" },
        }), { headers: { "Content-Type": "application/json" } });
      },
    });

    const voiceId = await resolveVoiceForSynthesis(
      17860,
      stored.service_voice_id ?? undefined,
    );
    assert.equal(registrations, 1);
    assert.equal(voiceId, "clone-22222222222222222222222222222222");
    assert.equal(getDefaultVoiceClone()?.service_voice_id, voiceId);
  });
});

it("uses the current bundled reference after a package path changes", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path.join(root, "appstate.db"));
  database.prepare("UPDATE voice_clones SET file_path = ?, service_voice_id = NULL WHERE id = ?")
    .run("/removed/previous-install/assets/voices/kana-default.wav", "kc-default");
  database.close();
  let registered = false;
  globalThis.fetch = async (_input, init) => {
    if (!init?.method) return Response.json({ voices: [], supports_voice_clone: true });
    const body = JSON.parse(String(init.body));
    assert.ok(Buffer.from(body.audio_base64, "base64").byteLength > 100);
    registered = true;
    return Response.json({ voice: { id: "new-install-voice" } });
  };
  assert.equal(await resolveVoiceForSynthesis(17860), "new-install-voice");
  assert.equal(registered, true);
});

it("honors a live service default without unnecessary voice cloning", async () => {
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, undefined);
    return Response.json({ default_voice_id: "operator-voice", voices: [{ id: "operator-voice" }], supports_voice_clone: true });
  };
  assert.equal(await resolveVoiceForSynthesis(17860), "operator-voice");
});
