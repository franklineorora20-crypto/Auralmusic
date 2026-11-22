import type { Track } from "./types";

/**
 * Offline audio storage.
 *
 * Audio blobs live in IndexedDB (browser storage quota applies) while the track
 * metadata that describes them is kept alongside the blob, so the offline
 * library can be rebuilt without any network access.
 */

export type OfflineRecord = {
  id: string;
  track: Track;
  blob: Blob;
  bytes: number;
  savedAt: number;
};

const DB_NAME = "aural-offline";
const STORE_NAME = "audio";
const DB_VERSION = 1;

let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("Persistent offline storage is unavailable in this browser."));
  }
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
    });
  }
  return database;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Offline storage could not be read."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage was interrupted."));
      }),
  );
}

async function readRecords(): Promise<OfflineRecord[]> {
  try {
    const records = await runTransaction<OfflineRecord[]>("readonly", (store) => store.getAll());
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

/** Offline tracks, with a fresh object URL bound to each stored blob. */
export async function listOfflineTracks(): Promise<Track[]> {
  const records = await readRecords();
  return records
    .filter((record) => record.blob instanceof Blob && record.blob.size > 0)
    .map(({ track, blob }) => ({
      ...track,
      streamUrl: URL.createObjectURL(blob),
      downloaded: true,
    }));
}

/** Metadata only — no object URLs, so it is safe to call often. */
export async function listOfflineMetadata(): Promise<Array<{ id: string; bytes: number; savedAt: number; track: Track }>> {
  const records = await readRecords();
  return records.map(({ id, bytes, savedAt, track }) => ({ id, bytes, savedAt, track }));
}

export async function saveOfflineTrack(track: Track, blob: Blob): Promise<void> {
  if (!blob.size) throw new Error("Refusing to store an empty audio file.");
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const record: OfflineRecord = {
      id: track.id,
      track: { ...track, downloaded: true },
      blob,
      bytes: blob.size,
      savedAt: Date.now(),
    };
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save this track offline."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving this track offline was interrupted."));
  });
}

export async function removeOfflineTrack(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the offline track."));
  });
}

export async function hasOfflineTrack(id: string): Promise<boolean> {
  const record = await runTransaction<OfflineRecord | undefined>("readonly", (store) => store.get(id));
  return Boolean(record);
}

export async function getOfflineUsage(): Promise<number> {
  const records = await readRecords();
  return records.reduce((total, record) => total + (Number.isFinite(record.bytes) ? record.bytes : 0), 0);
}

export async function clearOfflineStorage(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage could not be cleared."));
  });
}

/** Human readable byte sizes for the storage panel. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${megabytes.toFixed(1)} MB`;
}
