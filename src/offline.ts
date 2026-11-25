import type { ArtworkMatchType, ArtworkMetadata, ArtworkSource, Track } from "./types";

/**
 * Offline audio and artwork storage.
 *
 * Audio blobs, deduplicated cover art blobs, and artwork lookup records live
 * in IndexedDB (browser storage quota applies), so the offline library and
 * authentic album covers remain available without network access.
 */

export type OfflineRecord = {
  id: string;
  track: Track;
  blob: Blob;
  bytes: number;
  savedAt: number;
};

export type OfflineArtworkBlobRecord = {
  /** Canonical remote URL or content hash key so identical images are stored once. */
  key: string;
  blob: Blob;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  savedAt: number;
  lastAccessedAt: number;
};

export type OfflineArtworkLookupRecord = {
  lookupKey: string;
  status: "resolved" | "missing" | "error";
  source: ArtworkSource;
  attribution: string;
  confidence: number;
  matchType?: ArtworkMatchType;
  releaseTitle?: string;
  releaseArtist?: string;
  mbid?: string;
  remoteUrl?: string;
  remoteSmallUrl?: string;
  blobKey?: string;
  smallBlobKey?: string;
  width?: number;
  height?: number;
  checkedAt: number;
  expiresAt: number;
};

const DB_NAME = "aural-offline";
const STORE_NAME = "audio";
const ARTWORK_BLOB_STORE = "artwork_blobs";
const ARTWORK_LOOKUP_STORE = "artwork_lookup";
const DB_VERSION = 2;

const MAX_ARTWORK_BLOBS = 200;
const MAX_ARTWORK_BYTES = 64 * 1024 * 1024;

let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
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
        if (!db.objectStoreNames.contains(ARTWORK_BLOB_STORE)) {
          db.createObjectStore(ARTWORK_BLOB_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(ARTWORK_LOOKUP_STORE)) {
          db.createObjectStore(ARTWORK_LOOKUP_STORE, { keyPath: "lookupKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
    });
  }
  return database;
}

function runStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Offline storage could not be read."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage was interrupted."));
      }),
  );
}

async function readRecords(): Promise<OfflineRecord[]> {
  try {
    const records = await runStoreTransaction<OfflineRecord[]>(STORE_NAME, "readonly", (store) => store.getAll());
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

export async function updateOfflineTrackArtwork(
  id: string,
  artwork: string,
  artworkSmall?: string,
  artworkMeta?: ArtworkMetadata,
): Promise<Track | null> {
  const db = await openDatabase();
  return new Promise<Track | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(id);
    let updatedTrack: Track | null = null;

    getReq.onsuccess = () => {
      const existing = getReq.result as OfflineRecord | undefined;
      if (!existing) {
        resolve(null);
        return;
      }
      updatedTrack = {
        ...existing.track,
        artwork,
        artworkSmall: artworkSmall ?? artwork,
        ...(artworkMeta ? { artworkMeta } : {}),
      };
      store.put({
        ...existing,
        track: updatedTrack,
      });
    };
    getReq.onerror = () => reject(getReq.error ?? new Error("Could not read offline track."));
    transaction.oncomplete = () => resolve(updatedTrack);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not update track artwork."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Updating track artwork was interrupted."));
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
  const record = await runStoreTransaction<OfflineRecord | undefined>(STORE_NAME, "readonly", (store) => store.get(id));
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

/* -------------------------------------------------------------------------- */
/* Artwork Lookup & Deduplicated Blob Cache                                   */
/* -------------------------------------------------------------------------- */

export async function getArtworkLookup(lookupKey: string): Promise<OfflineArtworkLookupRecord | null> {
  try {
    const record = await runStoreTransaction<OfflineArtworkLookupRecord | undefined>(
      ARTWORK_LOOKUP_STORE,
      "readonly",
      (store) => store.get(lookupKey),
    );
    return record ?? null;
  } catch {
    return null;
  }
}

export async function saveArtworkLookup(record: OfflineArtworkLookupRecord): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ARTWORK_LOOKUP_STORE, "readwrite");
      transaction.objectStore(ARTWORK_LOOKUP_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not cache artwork lookup."));
    });
  } catch {
    // Non-fatal: in-memory cache still operates when IndexedDB is blocked.
  }
}

export async function deleteArtworkLookup(lookupKey: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ARTWORK_LOOKUP_STORE, "readwrite");
      transaction.objectStore(ARTWORK_LOOKUP_STORE).delete(lookupKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not delete artwork lookup."));
    });
  } catch {
    // Ignore storage errors.
  }
}

export async function getArtworkBlob(key: string): Promise<OfflineArtworkBlobRecord | null> {
  try {
    const record = await runStoreTransaction<OfflineArtworkBlobRecord | undefined>(
      ARTWORK_BLOB_STORE,
      "readonly",
      (store) => store.get(key),
    );
    if (!record || !(record.blob instanceof Blob) || record.blob.size === 0) return null;
    return record;
  } catch {
    return null;
  }
}

export async function touchArtworkBlob(key: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(ARTWORK_BLOB_STORE, "readwrite");
      const store = transaction.objectStore(ARTWORK_BLOB_STORE);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result as OfflineArtworkBlobRecord | undefined;
        if (existing) {
          store.put({ ...existing, lastAccessedAt: Date.now() });
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    // Ignore access-time update failures.
  }
}

async function pruneArtworkBlobsIfNeeded(): Promise<void> {
  try {
    const all = await runStoreTransaction<OfflineArtworkBlobRecord[]>(
      ARTWORK_BLOB_STORE,
      "readonly",
      (store) => store.getAll(),
    );
    if (!Array.isArray(all) || all.length === 0) return;

    const totalBytes = all.reduce((sum, entry) => sum + (Number.isFinite(entry.bytes) ? entry.bytes : 0), 0);
    if (all.length <= MAX_ARTWORK_BLOBS && totalBytes <= MAX_ARTWORK_BYTES) return;

    const sorted = [...all].sort((a, b) => (a.lastAccessedAt || a.savedAt) - (b.lastAccessedAt || b.savedAt));
    let remainingCount = all.length;
    let remainingBytes = totalBytes;
    const keysToDelete: string[] = [];

    for (const entry of sorted) {
      if (remainingCount <= MAX_ARTWORK_BLOBS && remainingBytes <= MAX_ARTWORK_BYTES) break;
      keysToDelete.push(entry.key);
      remainingCount -= 1;
      remainingBytes -= Number.isFinite(entry.bytes) ? entry.bytes : 0;
    }

    if (!keysToDelete.length) return;
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(ARTWORK_BLOB_STORE, "readwrite");
      const store = transaction.objectStore(ARTWORK_BLOB_STORE);
      for (const key of keysToDelete) store.delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    // Ignore pruning errors.
  }
}

export async function saveArtworkBlob(record: OfflineArtworkBlobRecord): Promise<void> {
  if (!(record.blob instanceof Blob) || record.blob.size === 0) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ARTWORK_BLOB_STORE, "readwrite");
      transaction.objectStore(ARTWORK_BLOB_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not cache artwork image."));
    });
    await pruneArtworkBlobsIfNeeded();
  } catch {
    // Non-fatal: remote URL can still be used while online.
  }
}

/** Human readable byte sizes for the storage panel. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${megabytes.toFixed(1)} MB`;
}
