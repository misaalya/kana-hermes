const DATABASE_NAME = "kana.local";
const DATABASE_VERSION = 1;

export const KANA_DATABASE_STORES = {
  conversations: "conversations",
  avatarModels: "avatarModels",
} as const;

let databasePromise: Promise<IDBDatabase> | null = null;

export function openKanaDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KANA_DATABASE_STORES.conversations)) {
        const store = database.createObjectStore(
          KANA_DATABASE_STORES.conversations,
          { keyPath: "id" },
        );
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!database.objectStoreNames.contains(KANA_DATABASE_STORES.avatarModels)) {
        const store = database.createObjectStore(
          KANA_DATABASE_STORES.avatarModels,
          { keyPath: "id" },
        );
        store.createIndex("importedAt", "importedAt");
      }
    });
    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => {
        database.close();
        databasePromise = null;
      });
      resolve(database);
    });
    request.addEventListener("error", () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open Kana's local database."));
    });
    request.addEventListener("blocked", () => {
      databasePromise = null;
      reject(new Error("Kana's local database upgrade is blocked by another tab."));
    });
  });

  return databasePromise;
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Kana local storage request failed.")),
    );
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Kana local storage was aborted.")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Kana local storage failed.")),
    );
  });
}
