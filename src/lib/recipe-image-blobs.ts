const DB_NAME = 'kondate-kanri-recipe-images';
const DB_VERSION = 1;
const STORE = 'blobs';

function blobKey(menuId: string, imageId: string): string {
  return `${menuId}::${imageId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function putRecipeImageBlob(menuId: string, imageId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, blobKey(menuId, imageId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getRecipeImageBlob(menuId: string, imageId: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(blobKey(menuId, imageId));
      r.onsuccess = () => resolve((r.result as Blob | undefined) ?? null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteRecipeImageBlob(menuId: string, imageId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(blobKey(menuId, imageId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteRecipeImageBlobsForMenu(menuId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const prefix = `${menuId}::`;
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
