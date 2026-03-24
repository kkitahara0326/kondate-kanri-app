import { canUseRecipeImageCompressWorker, compressArrayBufferWithWorker } from '@/lib/recipe-image-compress-worker-client';

/** メインスレッドで圧縮（Worker 非対応時のフォールバック） */
export async function compressImageFileToJpegBlobMain(
  file: File,
  opts?: { maxEdge?: number; quality?: number }
): Promise<Blob> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  const maxEdge = opts?.maxEdge ?? 560;
  const quality = opts?.quality ?? 0.6;
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
 * 優先: Web Worker + OffscreenCanvas（UIスレッドをほぼブロックしない）
 * フォールバック: メインスレッド canvas
 */
export async function compressImageFileToJpegBlob(
  file: File,
  opts?: { maxEdge?: number; quality?: number }
): Promise<Blob> {
  const maxEdge = opts?.maxEdge ?? 560;
  const quality = opts?.quality ?? 0.6;
  if (canUseRecipeImageCompressWorker()) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      return await compressArrayBufferWithWorker(
        arrayBuffer,
        file.type || 'application/octet-stream',
        maxEdge,
        quality
      );
    } catch {
      /* Worker 失敗時はメインへ */
    }
  }
  return compressImageFileToJpegBlobMain(file, { maxEdge, quality });
}
