/**
 * moc3 format versions. The Cubism Core can only revive a moc3 whose version
 * is at or below its own latest supported version; newer files fail inside
 * the Core with only a console log, which surfaces to users as "Unknown error".
 */

/** Latest moc3 version supported by the Cubism Core Kana has verified (5.1). */
export const FALLBACK_LATEST_MOC3_VERSION = 5;

const MOC3_MAGIC = [0x4d, 0x4f, 0x43, 0x33]; // "MOC3"

type CubismCoreVersionApi = {
  Version?: { csmGetLatestMocVersion?(): number };
};

/** Reads the format version byte from a moc3 header, or null if not moc3. */
export function readMoc3Version(header: ArrayBuffer | Uint8Array): number | null {
  const bytes = header instanceof Uint8Array ? header : new Uint8Array(header);
  if (bytes.length < 5) return null;
  for (let index = 0; index < MOC3_MAGIC.length; index += 1) {
    if (bytes[index] !== MOC3_MAGIC[index]) return null;
  }
  return bytes[4] || null;
}

/** The loaded Core's latest moc3 version, or Kana's verified fallback. */
export function latestSupportedMoc3Version(
  core: unknown = (globalThis as { Live2DCubismCore?: unknown }).Live2DCubismCore,
): number {
  try {
    const latest = (core as CubismCoreVersionApi | undefined)?.Version?.csmGetLatestMocVersion?.();
    if (typeof latest === "number" && Number.isInteger(latest) && latest > 0) return latest;
  } catch {
    // Fall through to the verified default.
  }
  return FALLBACK_LATEST_MOC3_VERSION;
}

export class UnsupportedMoc3VersionError extends Error {
  constructor(
    readonly version: number,
    readonly latestSupported: number,
  ) {
    super(
      `This Live2D model uses moc3 format version ${version}, which is newer than Kana's Cubism runtime supports (up to version ${latestSupported}). Export the model from Cubism Editor in an older moc3 format, or choose another avatar.`,
    );
    this.name = "UnsupportedMoc3VersionError";
  }
}

/**
 * Throws a clear error when a moc3 header is not a moc3 file or is newer than
 * the supported version. Headers that cannot be read are left to the runtime.
 */
export function assertSupportedMoc3(
  header: ArrayBuffer | Uint8Array,
  latestSupported = latestSupportedMoc3Version(),
): void {
  const version = readMoc3Version(header);
  if (version === null) {
    throw new Error("The Live2D model's .moc3 file is not a valid moc3 file.");
  }
  if (version > latestSupported) {
    throw new UnsupportedMoc3VersionError(version, latestSupported);
  }
}
