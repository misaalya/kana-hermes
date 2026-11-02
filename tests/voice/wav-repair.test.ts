import assert from "node:assert/strict";
import { it } from "node:test";
import { repairOpenWavSizes } from "@/lib/voice/wav-repair";

function openHead(dataBytes = 960): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, 36, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, 0, true);
  return bytes;
}

it("restores the sizes of a WAV head sent before synthesis finished", () => {
  const bytes = openHead();
  const repaired = repairOpenWavSizes(bytes.buffer as ArrayBuffer);
  const view = new DataView(repaired);
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint32(40, true), bytes.byteLength - 44);
});

it("leaves a body that is not an open WAV untouched", () => {
  const id3 = new TextEncoder().encode("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000");
  assert.equal(repairOpenWavSizes(id3.buffer as ArrayBuffer), id3.buffer);
  const short = new Uint8Array([82, 73, 70, 70]);
  assert.equal(repairOpenWavSizes(short.buffer as ArrayBuffer), short.buffer);
});
