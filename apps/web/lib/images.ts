import "server-only";
import { S3ObjectStore } from "@dgm/core/storage";

const VIEWABLE = /\.(png|jpe?g|webp|gif)$/i;
let store: S3ObjectStore | null | undefined;

function getStore(): S3ObjectStore | null {
  if (store === undefined) {
    try {
      store = new S3ObjectStore();
    } catch {
      store = null; // sin variables S3 (por ejemplo, en local)
    }
  }
  return store;
}

/** URL temporal (5 minutos) para ver una imagen del bucket privado. null si no se puede mostrar en el navegador. */
export async function imageUrl(storageKey: string | null): Promise<string | null> {
  if (!storageKey || !VIEWABLE.test(storageKey)) return null;
  const s = getStore();
  if (!s) return null;
  try {
    return await s.signedUrl(storageKey, 300);
  } catch {
    return null;
  }
}
