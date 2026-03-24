const WORKER_URL = '/workers/recipe-image-compress.js';

type PendingEntry = {
  resolve: (b: Blob) => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, PendingEntry>();

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
      const entry = pending.get(id);
      if (!entry) return;
      if (ok && ab) {
        entry.resolve(new Blob([ab], { type: 'image/jpeg' }));
      } else {
        entry.reject(new Error(error || 'Worker compression failed'));
      }
    };
    w.onerror = () => {
      for (const [, entry] of pending) {
        if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
        entry.reject(new Error('Worker crashed'));
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
  quality: number,
  options?: { timeoutMs?: number }
): Promise<Blob> {
  const w = getWorker();
  if (!w) throw new Error('Worker not available');
  const id = ++seq;
  const timeoutMs = options?.timeoutMs ?? 0;

  return new Promise<Blob>((outerResolve, outerReject) => {
    const entry: PendingEntry = {
      resolve: (b: Blob) => {
        if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
        pending.delete(id);
        outerResolve(b);
      },
      reject: (e: Error) => {
        if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
        pending.delete(id);
        outerReject(e);
      },
      timeoutId: null,
    };

    if (timeoutMs > 0) {
      entry.timeoutId = setTimeout(() => {
        if (!pending.delete(id)) return;
        outerReject(new Error('Worker timeout'));
      }, timeoutMs);
    }

    pending.set(id, entry);

    try {
      w.postMessage({ id, arrayBuffer, mimeType, maxEdge, quality }, [arrayBuffer]);
    } catch (e) {
      if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
      pending.delete(id);
      outerReject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
