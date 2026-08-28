import { createId } from "@/lib/conversation/types";
import {
  KANA_DATABASE_STORES,
  openKanaDatabase,
  requestResult,
  transactionDone,
} from "@/lib/storage/kana-indexed-db";
import {
  discoverLive2DModelCapabilities,
  type Live2DModelCapabilities,
} from "./live2d-model-capabilities";

type StoredAvatarFile = {
  name: string;
  relativePath: string;
  type: string;
  lastModified: number;
  content: Blob;
};

type StoredAvatarModel = {
  id: string;
  name: string;
  importedAt: number;
  modelSettingsPath: string;
  files: StoredAvatarFile[];
  capabilities?: Live2DModelCapabilities;
};

export type AvatarModelSummary = Pick<
  StoredAvatarModel,
  "id" | "name" | "importedAt" | "modelSettingsPath"
> & { sizeBytes: number; capabilities?: Live2DModelCapabilities };

export interface AvatarModelStore {
  import(files: File[]): Promise<AvatarModelSummary>;
  list(): Promise<AvatarModelSummary[]>;
  load(id: string): Promise<File[] | null>;
  inspect(id: string): Promise<Live2DModelCapabilities | null>;
  rename(id: string, name: string): Promise<AvatarModelSummary | null>;
  delete(id: string): Promise<void>;
}

function relativePath(file: File): string {
  return (file.webkitRelativePath || file.name).replaceAll("\\", "/");
}

function validatePath(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Unsafe Live2D model path: ${path}`);
  }
  return normalized;
}

function modelName(path: string): string {
  const parts = path.split("/");
  if (parts.length > 1) return parts[0] || "Imported Live2D model";
  return (parts.at(-1) ?? "Live2D model").replace(/\.model3\.json$/i, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveReference(settingsPath: string, reference: string): string {
  const base = settingsPath.split("/").slice(0, -1);
  const decoded = (() => {
    try {
      return decodeURIComponent(reference);
    } catch {
      return reference;
    }
  })();
  for (const part of decoded.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!base.length) {
        throw new Error(`Live2D asset escapes the imported folder: ${reference}`);
      }
      base.pop();
    } else {
      base.push(part);
    }
  }
  return validatePath(base.join("/"));
}

function fileReferences(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.FileReferences)) {
    throw new Error("The .model3.json file does not contain FileReferences.");
  }
  const references = value.FileReferences;
  const required: string[] = [];
  const append = (candidate: unknown) => {
    if (typeof candidate === "string" && candidate.trim()) {
      required.push(candidate.trim());
    }
  };

  append(references.Moc);
  if (!required.length || !String(references.Moc).endsWith(".moc3")) {
    throw new Error("The Live2D package must reference one .moc3 file.");
  }
  if (!Array.isArray(references.Textures) || !references.Textures.length) {
    throw new Error("The Live2D package must reference at least one texture.");
  }
  for (const texture of references.Textures) append(texture);
  for (const key of ["Physics", "Pose", "DisplayInfo", "UserData"]) {
    append(references[key]);
  }
  if (Array.isArray(references.Expressions)) {
    for (const expression of references.Expressions) {
      if (isRecord(expression)) append(expression.File);
    }
  }
  if (isRecord(references.Motions)) {
    for (const motions of Object.values(references.Motions)) {
      if (!Array.isArray(motions)) continue;
      for (const motion of motions) {
        if (isRecord(motion)) append(motion.File);
      }
    }
  }
  return [...new Set(required)];
}

export async function validateAvatarModelFiles(files: File[]): Promise<{
  modelSettingsPath: string;
  paths: string[];
  sizeBytes: number;
}> {
  if (!files.length) throw new Error("Choose a Live2D model folder first.");
  const paths = files.map((file) => validatePath(relativePath(file)));
  if (new Set(paths).size !== paths.length) {
    throw new Error("The Live2D folder contains duplicate relative file paths.");
  }
  const modelSettings = paths.filter((path) => path.endsWith(".model3.json"));
  if (modelSettings.length !== 1) {
    throw new Error(
      `Choose one complete Live2D folder with exactly one .model3.json file (found ${modelSettings.length}).`,
    );
  }

  const modelSettingsIndex = paths.indexOf(modelSettings[0]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await files[modelSettingsIndex].text());
  } catch {
    throw new Error("The selected .model3.json file is not valid JSON.");
  }
  const available = new Set(paths);
  const missing = fileReferences(parsed)
    .map((reference) => resolveReference(modelSettings[0], reference))
    .filter((path) => !available.has(path));
  if (missing.length) {
    throw new Error(
      `The Live2D folder is incomplete. Missing: ${missing.join(", ")}`,
    );
  }

  return {
    modelSettingsPath: modelSettings[0],
    paths,
    sizeBytes: files.reduce((total, file) => total + file.size, 0),
  };
}

function summary(record: StoredAvatarModel): AvatarModelSummary {
  return {
    id: record.id,
    name: record.name,
    importedAt: record.importedAt,
    modelSettingsPath: record.modelSettingsPath,
    capabilities: record.capabilities,
    sizeBytes: record.files.reduce(
      (total, file) => total + file.content.size,
      0,
    ),
  };
}

function storedFiles(record: StoredAvatarModel): File[] {
  return record.files.map((stored) => {
    const file = new File([stored.content], stored.name, {
      type: stored.type,
      lastModified: stored.lastModified,
    });
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: stored.relativePath,
    });
    return file;
  });
}

export class IndexedDbAvatarModelStore implements AvatarModelStore {
  async import(files: File[]): Promise<AvatarModelSummary> {
    const validation = await validateAvatarModelFiles(files);
    const { paths, modelSettingsPath } = validation;
    const capabilities = await discoverLive2DModelCapabilities(files);

    const record: StoredAvatarModel = {
      id: createId("avatar"),
      name: modelName(modelSettingsPath),
      importedAt: Date.now(),
      modelSettingsPath,
      capabilities,
      files: files.map((file, index) => ({
        name: file.name,
        relativePath: paths[index],
        type: file.type,
        lastModified: file.lastModified,
        content: file.slice(0, file.size, file.type),
      })),
    };

    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.avatarModels,
      "readwrite",
    );
    transaction.objectStore(KANA_DATABASE_STORES.avatarModels).put(record);
    try {
      await transactionDone(transaction);
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        throw new Error(
          "The Live2D model is larger than the browser's available local storage.",
        );
      }
      throw error;
    }

    return summary(record);
  }

  async list(): Promise<AvatarModelSummary[]> {
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.avatarModels,
      "readonly",
    );
    const records = (await requestResult(
      transaction.objectStore(KANA_DATABASE_STORES.avatarModels).getAll(),
    )) as StoredAvatarModel[];
    await transactionDone(transaction);
    return records
      .map(summary)
      .sort((left, right) => right.importedAt - left.importedAt);
  }

  async load(id: string): Promise<File[] | null> {
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.avatarModels,
      "readonly",
    );
    const result = (await requestResult(
      transaction.objectStore(KANA_DATABASE_STORES.avatarModels).get(id),
    )) as StoredAvatarModel | undefined;
    await transactionDone(transaction);
    if (!result) return null;

    return storedFiles(result);
  }

  async inspect(id: string): Promise<Live2DModelCapabilities | null> {
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.avatarModels,
      "readonly",
    );
    const result = (await requestResult(
      transaction.objectStore(KANA_DATABASE_STORES.avatarModels).get(id),
    )) as StoredAvatarModel | undefined;
    await transactionDone(transaction);
    if (!result) return null;
    return result.capabilities ?? discoverLive2DModelCapabilities(storedFiles(result));
  }

  async rename(id: string, name: string): Promise<AvatarModelSummary | null> {
    const nextName = name.trim();
    if (!nextName) throw new Error("Avatar name cannot be empty.");
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.avatarModels,
      "readwrite",
    );
    const store = transaction.objectStore(KANA_DATABASE_STORES.avatarModels);
    const record = (await requestResult(store.get(id))) as
      | StoredAvatarModel
      | undefined;
    if (!record) {
      await transactionDone(transaction);
      return null;
    }
    const renamed = { ...record, name: nextName };
    store.put(renamed);
    await transactionDone(transaction);
    return summary(renamed);
  }

  async delete(id: string): Promise<void> {
    const database = await openKanaDatabase();
    const transaction = database.transaction(
      KANA_DATABASE_STORES.avatarModels,
      "readwrite",
    );
    transaction.objectStore(KANA_DATABASE_STORES.avatarModels).delete(id);
    await transactionDone(transaction);
  }
}
