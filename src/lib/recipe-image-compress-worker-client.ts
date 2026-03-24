const WORKER_URL = '/workers/recipe-image-compress.js';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (b: Blob) => void; reject: (e: Error) => void }
>();

function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (typeof createImageBitmap === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(WORKER_URL);
    w.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; arrayBuffer?: ArrayBuffer; error?: string }>) => {
      const { id, ok, arrayBuffer: ab, error } = ev.data;
      const p = pending.get(id);
      pending.delete(id);
      if (!p) return;
      if (ok && ab) {
        p.resolve(new Blob([ab], { type: 'image/jpeg' }));
      } else {
        p.reject(new Error(error || 'Worker compression failed'));
      }
    };
    w.onerror = () => {
      for (const [, pr] of pending) {
        pr.reject(new Error('Worker crashed'));
      }
      pending.clear();
      terminateWorker();
    };
    worker = w;
    return worker;
  } catch {
    return null;
  }
}

export function canUseRecipeImageCompressWorker(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

export async function compressArrayBufferWithWorker(
  arrayBuffer: ArrayBuffer,
  mimeType: string,
  maxEdge: number,
  quality: number
): Promise<Blob> {
  const w = getWorker();
  if (!w) throw new Error('Worker not available');
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ id, arrayBuffer, mimeType, maxEdge, quality }, [arrayBuffer]);
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
