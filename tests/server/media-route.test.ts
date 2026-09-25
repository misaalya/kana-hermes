import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { GET, HEAD } from "@/app/api/media/[token]/[name]/route";
import { createSessionToken } from "@/lib/server/auth/session";
import { changeAccessPassword } from "@/lib/server/auth/password-store";
import { mediaToken, mediaUrl } from "@/lib/server/media-links";

const root = mkdtempSync(path.join(tmpdir(), "kana-media-route-"));
const files = path.join(root, "files");
const previous = process.env.KANA_DATA_DIR;
const audio = path.join(files, "tts_1.mp3");
const drawing = path.join(files, "drawing.svg");
const report = path.join(files, "Laporan akhir.pdf");
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));
let cookie = "";

before(async () => {
  process.env.KANA_DATA_DIR = path.join(root, "kana-data");
  mkdirSync(files, { recursive: true });
  writeFileSync(audio, bytes);
  writeFileSync(drawing, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  writeFileSync(report, "%PDF-1.4");
  await changeAccessPassword("media-route-secret");
  cookie = `kana_session=${await createSessionToken()}`;
});

after(() => {
  if (previous === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

function request(url: string, headers: Record<string, string> = {}, method = "GET") {
  const [, , token, name] = new URL(url, "http://kana.test").pathname.split("/").slice(1);
  const handler = method === "HEAD" ? HEAD : GET;
  return handler(new Request(new URL(url, "http://kana.test"), { method, headers: { Cookie: cookie, ...headers } }), {
    params: Promise.resolve({ token, name }),
  });
}

it("needs a Kana session", async () => {
  const response = await GET(new Request(`http://kana.test${mediaUrl(audio)}`), {
    params: Promise.resolve({ token: mediaToken(audio), name: "tts_1.mp3" }),
  });
  assert.equal(response.status, 401);
});

it("streams the whole file inline with its type, name, and safety headers", async () => {
  const response = await request(mediaUrl(audio));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("content-length"), "1000");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline; filename="tts_1.mp3"/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);
});

it("serves byte ranges so audio and video can seek", async () => {
  const middle = await request(mediaUrl(audio), { Range: "bytes=100-199" });
  assert.equal(middle.status, 206);
  assert.equal(middle.headers.get("content-range"), "bytes 100-199/1000");
  assert.deepEqual(Buffer.from(await middle.arrayBuffer()), bytes.subarray(100, 200));

  const open = await request(mediaUrl(audio), { Range: "bytes=990-" });
  assert.equal(open.headers.get("content-range"), "bytes 990-999/1000");
  assert.equal((await open.arrayBuffer()).byteLength, 10);

  const suffix = await request(mediaUrl(audio), { Range: "bytes=-5" });
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(995));

  const past = await request(mediaUrl(audio), { Range: "bytes=5000-" });
  assert.equal(past.status, 416);
  assert.equal(past.headers.get("content-range"), "bytes */1000");

  const several = await request(mediaUrl(audio), { Range: "bytes=0-1,5-6" });
  assert.equal(several.status, 200, "several ranges get the whole file");
});

it("answers HEAD, revalidates by ETag, and ignores a stale If-Range", async () => {
  const head = await request(mediaUrl(audio), {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "1000");
  assert.equal(head.body, null);
  const etag = head.headers.get("etag") ?? "";
  assert.equal((await request(mediaUrl(audio), { "If-None-Match": etag })).status, 304);
  const stale = await request(mediaUrl(audio), { Range: "bytes=0-9", "If-Range": 'W/"old"' });
  assert.equal(stale.status, 200);
});

it("offers downloads, and never shows SVG or PDF inline", async () => {
  const download = await request(`${mediaUrl(audio)}?download`);
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
  const svg = await request(mediaUrl(drawing));
  assert.match(svg.headers.get("content-disposition") ?? "", /^attachment;/);
  const pdf = await request(mediaUrl(report));
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(
    pdf.headers.get("content-disposition"),
    `attachment; filename="Laporan akhir.pdf"; filename*=UTF-8''Laporan%20akhir.pdf`,
  );
});

it("answers 404 for forged tokens and for files that are gone or now denied", async () => {
  const forged = mediaToken(audio).slice(0, -2) + "AA";
  assert.equal((await request(`/api/media/${forged}/tts_1.mp3`)).status, 404);
  const secret = path.join(root, "kana-data", "jwt-secret");
  assert.equal((await request(`/api/media/${mediaToken(secret)}/jwt-secret`)).status, 404, "Kana's own data is never served");
  const gone = path.join(files, "gone.mp3");
  writeFileSync(gone, "x");
  const url = mediaUrl(gone);
  rmSync(gone);
  const response = await request(url);
  assert.equal(response.status, 404);
  assert.match(JSON.stringify(await response.json()), /no longer available/);
});
