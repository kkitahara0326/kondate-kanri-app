import { canUseRecipeImageCompressWorker, compressArrayBufferWithWorker } from '@/lib/recipe-image-compress-worker-client';

/** これ以下は再エンコードをスキップ（多くのスクショが該当し、待ち時間を大きく削る） */
export const SKIP_RECOMPRESS_MAX_BYTES = 220_000;

/** Worker がこの時間を超えたらメインスレッドの速いフォールバックへ（目標 ~3 秒） */
const WORKER_TIMEOUT_MS = 2200;

const FAST_MAX_EDGE = 400;
const FAST_QUALITY = 0.5;
const FALLBACK_MAX_EDGE = 300;
const FALLBACK_QUALITY = 0.45;

/** メインスレッドで圧縮（Worker 非対応・タイムアウト後のフォールバック） */
export async function compressImageFileToJpegBlobMain(
  file: File,
  opts?: { maxEdge?: number; quality?: number }
): Promise<Blob> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  const maxEdge = opts?.maxEdge ?? FAST_MAX_EDGE;
  const quality = opts?.quality ?? FAST_QUALITY;
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('画像変換に失敗しました'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (b) => {
            URL.revokeObjectURL(objectUrl);
            if (b) resolve(b);
            else reject(new Error('画像のエンコードに失敗しました'));
          },
          'image/jpeg',
          quality
        );
      } catch (e) {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('画像の読み込みに失敗しました'));
    };
    img.src = objectUrl;
  });
}

/**
 * レシピ画像用の最終 Blob（小さいファイルはそのまま、大きいものは速い設定で圧縮）
 * 体感・実時間とも 3 秒前後を目安に調整
 */
export async function prepareRecipeImageBlob(file: File): Promise<Blob> {
  if (file.size <= SKIP_RECOMPRESS_MAX_BYTES) {
    return file;
  }

  if (canUseRecipeImageCompressWorker()) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      return await compressArrayBufferWithWorker(
        arrayBuffer,
        file.type || 'application/octet-stream',
        FAST_MAX_EDGE,
        FAST_QUALITY,
        { timeoutMs: WORKER_TIMEOUT_MS }
      );
    } catch {
      /* timeout / worker 失敗 */
    }
  }

  return compressImageFileToJpegBlobMain(file, {
    maxEdge: FALLBACK_MAX_EDGE,
    quality: FALLBACK_QUALITY,
  });
}

/**
 * 互換: 常に JPEG へ圧縮したい場合（旧呼び出し用）
 */
export async function compressImageFileToJpegBlob(
  file: File,
  opts?: { maxEdge?: number; quality?: number }
): Promise<Blob> {
  const maxEdge = opts?.maxEdge ?? FAST_MAX_EDGE;
  const quality = opts?.quality ?? FAST_QUALITY;
  if (canUseRecipeImageCompressWorker()) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      return await compressArrayBufferWithWorker(
        arrayBuffer,
        file.type || 'application/octet-stream',
        maxEdge,
        quality,
        { timeoutMs: WORKER_TIMEOUT_MS }
      );
    } catch {
      /* fall through */
    }
  }
  return compressImageFileToJpegBlobMain(file, { maxEdge, quality });
}
