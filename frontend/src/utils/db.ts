// IndexedDB local storage wrapper for buffering chunked WebRTC files

const DB_NAME = "nukechat_db";
const DB_VERSION = 1;

export interface DbFileMetadata {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  totalChunks: number;
  hash: string;
  senderId: string;
}

export function initDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      
      // Store file metadata
      if (!db.objectStoreNames.contains("files")) {
        const filesStore = db.createObjectStore("files", { keyPath: "fileId" });
        filesStore.createIndex("senderId", "senderId", { unique: false });
      }

      // Store binary chunks
      if (!db.objectStoreNames.contains("chunks")) {
        const chunksStore = db.createObjectStore("chunks", { keyPath: "chunkKey" });
        chunksStore.createIndex("fileId", "fileId", { unique: false });
      }
    };
  });
}

export async function storeFileMetadata(meta: DbFileMetadata): Promise<void> {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    const request = store.put(meta);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function storeChunk(fileId: string, chunkIndex: number, data: ArrayBuffer): Promise<void> {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks", "readwrite");
    const store = tx.objectStore("chunks");
    const chunkKey = `${fileId}_${chunkIndex}`;
    
    const request = store.put({
      chunkKey,
      fileId,
      chunkIndex,
      data,
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getFileChunks(fileId: string, totalChunks: number): Promise<ArrayBuffer[]> {
  const db = await initDb();
  const chunks: ArrayBuffer[] = new Array(totalChunks);

  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks", "readonly");
    const store = tx.objectStore("chunks");
    const index = store.index("fileId");
    const request = index.getAll(fileId);

    request.onsuccess = () => {
      const results = request.result || [];
      for (const item of results) {
        if (item.chunkIndex < totalChunks) {
          chunks[item.chunkIndex] = item.data;
        }
      }
      resolve(chunks);
    };

    request.onerror = () => reject(request.error);
  });
}

export async function deleteFile(fileId: string): Promise<void> {
  const db = await initDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["files", "chunks"], "readwrite");
    
    // Delete file metadata
    tx.objectStore("files").delete(fileId);

    // Delete chunks associated with fileId
    const chunksStore = tx.objectStore("chunks");
    const index = chunksStore.index("fileId");
    const request = index.openCursor(fileId);

    request.onsuccess = (event: any) => {
      const cursor = event.target.result;
      if (cursor) {
        chunksStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Deletes all file metadata and associated chunks belonging to a specific sender.
 * Triggered when a peer departs the P2P chat room.
 */
export async function deleteSenderFiles(senderId: string): Promise<void> {
  const db = await initDb();
  
  // Find all fileIds owned by the senderId
  const fileIds: string[] = await new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const index = store.index("senderId");
    const request = index.getAllKeys(senderId);

    request.onsuccess = () => resolve((request.result as string[]) || []);
    request.onerror = () => reject(request.error);
  });

  // Delete each file and its chunks
  for (const fileId of fileIds) {
    await deleteFile(fileId);
  }
}

/**
 * Wipes out the entire database. Used on room nuke/destruction.
 */
export function wipeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
