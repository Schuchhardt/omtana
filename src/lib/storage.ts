import { db } from "./supabase";

export const AUDIO_BUCKET = "omtana-audio";

/** Minutos de vida de las URLs firmadas que recibe el reproductor. */
const SIGNED_TTL_SECONDS = 60 * 60 * 3;

export async function ensureBucket(): Promise<void> {
  const { data } = await db().storage.listBuckets();
  if (data?.some((b) => b.name === AUDIO_BUCKET)) return;

  // Privado a propósito: el audio solo sale por URL firmada desde el servidor.
  const { error } = await db().storage.createBucket(AUDIO_BUCKET, {
    public: false,
    fileSizeLimit: "80MB",
    allowedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/wav", "video/mp4"],
  });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
}

export async function uploadAudio(
  path: string,
  body: Buffer | Uint8Array,
  contentType = "audio/mpeg",
): Promise<string> {
  const { error } = await db()
    .storage.from(AUDIO_BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Subida fallida (${path}): ${error.message}`);
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
