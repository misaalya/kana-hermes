import { createId } from "@/lib/conversation/types";
import {
  KANA_DATABASE_STORES,
  openKanaDatabase,
  requestResult,
  transactionDone,
} from "@/lib/storage/kana-indexed-db";

const MAX_BACKGROUND_BYTES = 25 * 1024 * 1024;

const SUPPORTED_STAGE_BACKGROUND_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
] as const;

export type StageBackgroundAsset = {
  id: string;
  name: string;
  type: string;
  importedAt: number;
  content: Blob;
};

export type StageBackgroundSummary = Omit<StageBackgroundAsset, "content"> & {
  sizeBytes: number;
};

function displayName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").trim().slice(0, 120)
    || "My background";
}

export function validateStageBackgroundFile(file: File): void {
  if (!file.size) {
    throw new Error("The selected background image is empty.");
  }
  if (file.size > MAX_BACKGROUND_BYTES) {
    throw new Error("Choose a background image smaller than 25 MB.");
  }
  if (!(SUPPORTED_STAGE_BACKGROUND_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Use a PNG, JPEG, WebP, GIF, AVIF, or BMP image.");
  }
}

function summary(asset: StageBackgroundAsset): StageBackgroundSummary {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    importedAt: asset.importedAt,
    sizeBytes: asset.content.size,
  };
}

export class IndexedDbStageBackgroundStore {
  async import(file: File): Promise<StageBackgroundSummary> {
    validateStageBackgroundFile(file);
    const asset: StageBackgroundAsset = {
      id: createId("background"),
      name: displayName(file),
      type: file.type,
      importedAt: Date.now(),
      content: file.slice(0, file.size, file.type),
    };
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.stageBackgrounds,
      "readwrite",
    );
    transaction.objectStore(KANA_DATABASE_STORES.stageBackgrounds).put(asset);
    try {
      await transactionDone(transaction);
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        throw new Error("This image is larger than the browser's available local storage.");
      }
      throw error;
    }
    return summary(asset);
  }

  async list(): Promise<StageBackgroundSummary[]> {
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.stageBackgrounds,
      "readonly",
    );
    const assets = (await requestResult(
      transaction.objectStore(KANA_DATABASE_STORES.stageBackgrounds).getAll(),
    )) as StageBackgroundAsset[];
    await transactionDone(transaction);
    return assets
      .map(summary)
      .sort((left, right) => right.importedAt - left.importedAt);
  }

  async load(id: string): Promise<StageBackgroundAsset | null> {
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.stageBackgrounds,
      "readonly",
    );
    const asset = (await requestResult(
      transaction.objectStore(KANA_DATABASE_STORES.stageBackgrounds).get(id),
    )) as StageBackgroundAsset | undefined;
    await transactionDone(transaction);
    return asset ?? null;
  }

  async delete(id: string): Promise<void> {
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.stageBackgrounds,
      "readwrite",
    );
    transaction.objectStore(KANA_DATABASE_STORES.stageBackgrounds).delete(id);
    await transactionDone(transaction);
  }
}
