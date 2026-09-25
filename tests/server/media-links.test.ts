import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  deliverablePath,
  mediaToken,
  mediaUrl,
  pathFromMediaToken,
  rewriteMediaInEvent,
  rewriteMediaInResult,
  rewriteMediaTags,
} from "@/lib/server/media-links";

const root = mkdtempSync(path.join(tmpdir(), "kana-media-links-"));
const home = path.join(root, "home");
const files = path.join(root, "files");
const previous = { home: process.env.HOME, data: process.env.KANA_DATA_DIR, hermes: process.env.HERMES_HOME };
const audio = path.join(home, ".hermes", "cache", "audio", "tts_1.mp3");
const spaced = path.join(files, "My Report 2.pdf");

before(() => {
  process.env.HOME = home;
  process.env.KANA_DATA_DIR = path.join(root, "kana-data");
  delete process.env.HERMES_HOME;
  for (const file of [
    audio,
    spaced,
    path.join(files, "photo.png"),
    path.join(home, ".ssh", "id_rsa"),
    path.join(home, ".hermes", "config.yaml"),
    path.join(home, ".hermes", ".env"),
    path.join(home, ".config", "app", "token"),
    path.join(root, "kana-data", "jwt-secret"),
  ]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, file.endsWith("jwt-secret") ? "x".repeat(64) : "data");
  }
  symlinkSync(path.join(home, ".ssh", "id_rsa"), path.join(files, "innocent.png"));
});

after(() => {
  for (const [key, value] of [["HOME", previous.home], ["KANA_DATA_DIR", previous.data], ["HERMES_HOME", previous.hermes]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("media delivery rule", () => {
  it("allows Hermes's cache and ordinary files, resolving ~", () => {
    assert.equal(deliverablePath(audio), audio);
    assert.equal(deliverablePath("~/.hermes/cache/audio/tts_1.mp3"), audio);
    assert.equal(deliverablePath(spaced), spaced);
  });

  it("denies credentials, system paths, Kana's own data, and symlinks into them", () => {
    for (const denied of [
      path.join(home, ".ssh", "id_rsa"),
      path.join(home, ".hermes", "config.yaml"),
      path.join(home, ".hermes", ".env"),
      path.join(home, ".config", "app", "token"),
      path.join(root, "kana-data", "jwt-secret"),
      path.join(files, "innocent.png"),
      "/etc/hostname",
      "/proc/self/environ",
    ]) {
      assert.equal(deliverablePath(denied), null, denied);
    }
  });

  it("denies what is not an existing regular file with an absolute path", () => {
    for (const candidate of [files, path.join(files, "missing.mp3"), "relative/file.mp3", `${audio}\0.png`]) {
      assert.equal(deliverablePath(candidate), null, candidate);
    }
  });
});

describe("media tokens", () => {
  it("round-trip, stay stable for one file, and hide the path", () => {
    const token = mediaToken(audio);
    assert.equal(pathFromMediaToken(token), audio);
    assert.equal(mediaToken(audio), token, "the same file always gets the same link");
    assert.notEqual(mediaToken(spaced), token);
    assert.doesNotMatch(Buffer.from(token, "base64url").toString("latin1"), /hermes|tts_1/);
    assert.equal(mediaUrl(audio), `/api/media/${token}/tts_1.mp3`);
    assert.match(mediaUrl(spaced), /\/My%20Report%202\.pdf$/);
  });

  it("reject anything Kana did not mint", () => {
    const token = mediaToken(audio);
    const flipped = Buffer.from(token, "base64url");
    flipped[flipped.length - 1] ^= 1;
    for (const forged of [flipped.toString("base64url"), Buffer.from(audio).toString("base64url"), "", "a/b", "x".repeat(9000)]) {
      assert.equal(pathFromMediaToken(forged), null);
    }
  });
});

describe("rewriting MEDIA tags", () => {
  it("replaces a deliverable path with its link and keeps the prose around it", () => {
    const text = `Hehe, tentu dong~ Suaranya lebih imut.\n\nMEDIA:${audio}.`;
    assert.equal(rewriteMediaTags(text), `Hehe, tentu dong~ Suaranya lebih imut.\n\nMEDIA:${mediaUrl(audio)}.`);
    assert.equal(rewriteMediaTags(`**MEDIA: ${audio}**`), `**MEDIA: ${mediaUrl(audio)}**`);
  });

  it("handles quoted and spaced paths, and two tags glued together", () => {
    const photo = path.join(files, "photo.png");
    assert.equal(rewriteMediaTags(`MEDIA:"${spaced}"`), `MEDIA:${mediaUrl(spaced)}`);
    assert.equal(rewriteMediaTags(`MEDIA:\`${spaced}\``), `MEDIA:${mediaUrl(spaced)}`);
    assert.equal(rewriteMediaTags(`Here: MEDIA:${spaced} ok`), `Here: MEDIA:${mediaUrl(spaced)} ok`);
    assert.equal(rewriteMediaTags(`MEDIA:${audio}MEDIA:${photo}`), `MEDIA:${mediaUrl(audio)}MEDIA:${mediaUrl(photo)}`);
  });

  it("leaves missing, denied, and code-example paths exactly as written", () => {
    for (const text of [
      "MEDIA:/absolute/path/to/file",
      `MEDIA:${path.join(home, ".ssh", "id_rsa")}`,
      `Use \`MEDIA:${audio}\` in a reply.`,
      `\`\`\`\nMEDIA:${audio}\n\`\`\``,
      "No tags at all.",
    ]) {
      assert.equal(rewriteMediaTags(text), text);
    }
  });

  it("rewrites Hermes's replies and tool output but never the user's own rows", () => {
    const result = rewriteMediaInResult({
      messages: [
        { role: "user", text: `MEDIA:${audio}` },
        { role: "assistant", text: `MEDIA:${audio}` },
        { role: "tool", context: [`MEDIA:${audio}`] },
      ],
    });
    assert.equal(result.messages[0].text, `MEDIA:${audio}`);
    assert.equal(result.messages[1].text, `MEDIA:${mediaUrl(audio)}`);
    assert.deepEqual(result.messages[2].context, [`MEDIA:${mediaUrl(audio)}`]);
  });

  it("rewrites finished events and drops streamed chunks, which can split a path", () => {
    const complete = rewriteMediaInEvent({ type: "message.complete", session_id: "s", payload: { text: `MEDIA:${audio}` } });
    assert.equal(complete.payload.text, `MEDIA:${mediaUrl(audio)}`);
    const delta = rewriteMediaInEvent({ type: "message.delta", session_id: "s", payload: { text: `MEDIA:${path.dirname(audio)}` } });
    assert.deepEqual(delta, { type: "message.delta", session_id: "s", payload: { text: "" } });
  });
});
