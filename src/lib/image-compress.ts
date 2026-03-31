/**
 * 画像圧縮は無効化。
 * 画質優先のため、現在は元ファイルをそのまま扱う。
 */
export const SKIP_RECOMPRESS_MAX_BYTES = Number.POSITIVE_INFINITY;

export async function compressImageFileToJpegBlobMain(
  file: File,
  _opts?: { maxEdge?: number; quality?: number }
): Promise<Blob> {
  void _opts;
  return file;
}

export async function prepareRecipeImageBlob(file: File): Promise<Blob> {
  return file;
}

/**
 * 互換API（現在は no-op）
 */
export async function compressImageFileToJpegBlob(
  file: File,
  _opts?: { maxEdge?: number; quality?: number }
): Promise<Blob> {
  void _opts;
  return file;
}
