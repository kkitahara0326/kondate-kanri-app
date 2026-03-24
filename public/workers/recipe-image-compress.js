/* eslint-disable no-restricted-globals */
/**
 * 献立レシピ画像: デコード・縮小・JPEG 化（メインスレッドをブロックしない）
 * postMessage({ id, arrayBuffer, mimeType, maxEdge, quality }, [arrayBuffer])
 * → postMessage({ id, ok, arrayBuffer? }, [arrayBuffer?]) | { ok:false, error }
 */
self.onmessage = async (ev) => {
  const { id, arrayBuffer, mimeType, maxEdge, quality } = ev.data;
  if (!arrayBuffer) {
    self.postMessage({ id, ok: false, error: 'no buffer' });
    return;
  }
  let bmp;
  try {
    const blob = new Blob([arrayBuffer], { type: mimeType || 'application/octet-stream' });
    bmp = await createImageBitmap(blob);
    const sw = bmp.width;
    const sh = bmp.height;
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.drawImage(bmp, 0, 0, sw, sh, 0, 0, w, h);
    const q = Math.min(1, Math.max(0.35, Number(quality) || 0.6));
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: q });
    const buf = await out.arrayBuffer();
    self.postMessage({ id, ok: true, arrayBuffer: buf }, [buf]);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  } finally {
    if (bmp && typeof bmp.close === 'function') bmp.close();
  }
};
