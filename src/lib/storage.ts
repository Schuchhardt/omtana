import { db } from "./supabase";

export const AUDIO_BUCKET = "omtana-audio";

/** Minutos de vida de las URLs firmadas que recibe el reproductor. */
const SIGNED_TTL_SECONDS = 60 * 60 * 3;

export async function ensureBucket(): Promise<void> {
  const { data } = await db().storage.listBuckets();
  if (data?.some((b) => b.name === AUDIO_BUCKET)) return;

  // Privado a propósito: el audio solo sale por URL firmada desde el servidor.
  // Sin fileSizeLimit propio: hereda el límite global del proyecto, así que si
  // lo subes en Supabase el bucket lo sigue sin tocar código.
  const { error } = await db().storage.createBucket(AUDIO_BUCKET, {
    public: false,
    allowedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/wav", "video/mp4"],
  });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
}

export class FileTooLargeError extends Error {}

export async function uploadAudio(
  path: string,
  body: Buffer | Uint8Array,
  contentType = "audio/mpeg",
): Promise<string> {
  const { error } = await db()
    .storage.from(AUDIO_BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) {
    if (/exceeded the maximum allowed size|Payload too large/i.test(error.message)) {
      throw new FileTooLargeError(
        `${path} pasa el límite de subida del proyecto ` +
          `(${(body.byteLength / 1048576).toFixed(0)} MB). Súbelo en Supabase → Storage → Settings.`,
      );
    }
    throw new Error(`Subida fallida (${path}): ${error.message}`);
  }
  return path;
}

export async function downloadAudio(path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(AUDIO_BUCKET).download(path);
  if (error || !data) throw new Error(`No se pudo bajar ${path}: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function signedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db()
    .storage.from(AUDIO_BUCKET)
    .createSignedUrl(path, SIGNED_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

/**
 * Varias URLs firmadas en una sola llamada. El reproductor necesita la pista
 * de cada tema de fondo, y firmarlas de a una eran treinta viajes al servidor.
 * Devuelve un arreglo alineado con `paths`: `null` donde no se pudo firmar.
 */
export async function signedUrls(paths: string[]): Promise<(string | null)[]> {
  if (paths.length === 0) return [];
  const { data } = await db()
    .storage.from(AUDIO_BUCKET)
    .createSignedUrls(paths, SIGNED_TTL_SECONDS);

  const byPath = new Map((data ?? []).map((row) => [row.path, row.signedUrl]));
  return paths.map((path) => byPath.get(path) ?? null);
}

/** Borra archivos del bucket. Lo que no existe se ignora sin ruido. */
export async function removeAudio(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await db().storage.from(AUDIO_BUCKET).remove(paths);
  if (error) throw new Error(`No se pudieron borrar (${paths.join(", ")}): ${error.message}`);
}
