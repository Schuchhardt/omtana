import { db } from "./supabase";

export const AUDIO_BUCKET = "omtana-audio";

/** Minutos de vida de las URLs firmadas que recibe el reproductor. */
const SIGNED_TTL_SECONDS = 60 * 60 * 3;

/**
 * Lo que el bucket acepta. `text/plain` es por los subtítulos que acompañan a
 * cada video: sin él la subida del `.srt` vuelve rechazada y el video queda sin
 * su pista de texto en YouTube.
 */
const MIME_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav", "video/mp4", "text/plain"];

export async function ensureBucket(): Promise<void> {
  const { data } = await db().storage.listBuckets();
  const existing = data?.find((b) => b.name === AUDIO_BUCKET) as
    | { public?: boolean; allowed_mime_types?: string[] | null }
    | undefined;

  if (existing) {
    // Un bucket creado antes de que hubiera videos no conoce los tipos nuevos,
    // y la lista solo se puede ampliar desde acá: en Supabase es una pantalla
    // que nadie va a recordar abrir. `null` significa "cualquier tipo".
    const allowed = existing.allowed_mime_types;
    if (!allowed) return;

    const missing = MIME_TYPES.filter((type) => !allowed.includes(type));
    if (missing.length === 0) return;

    const { error } = await db().storage.updateBucket(AUDIO_BUCKET, {
      // `public` es obligatorio en la actualización: se repite el que ya tiene
      // para ampliar los tipos sin decidir de paso quién puede leerlo.
      public: existing.public ?? false,
      allowedMimeTypes: [...allowed, ...missing],
    });
    if (error) throw new Error(`No se pudo ampliar el bucket: ${error.message}`);
    return;
  }

  // Privado a propósito: el audio solo sale por URL firmada desde el servidor.
  // Sin fileSizeLimit propio: hereda el límite global del proyecto, así que si
  // lo subes en Supabase el bucket lo sigue sin tocar código.
  const { error } = await db().storage.createBucket(AUDIO_BUCKET, {
    public: false,
    allowedMimeTypes: MIME_TYPES,
  });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
}

export class FileTooLargeError extends Error {}

/** Intentos de subida antes de rendirse, y cuánto se espera entre ellos. */
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_BACKOFF_MS = 1500;

/**
 * Sube un audio, reintentando los fallos de red.
 *
 * Para cuando se llega acá el archivo ya costó: minutos de síntesis, o una
 * generación entera. Un "fetch failed" pasajero — que aparece al subir muchos
 * archivos seguidos — tiraba todo ese trabajo a la basura. Los errores que no
 * se arreglan esperando (archivo muy grande, permisos) salen al primer intento.
 */
export async function uploadAudio(
  path: string,
  body: Buffer | Uint8Array,
  contentType = "audio/mpeg",
): Promise<string> {
  let last = "";

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    const { error } = await db()
      .storage.from(AUDIO_BUCKET)
      .upload(path, body, { contentType, upsert: true });

    if (!error) return path;

    // Un tipo de archivo que el bucket no acepta no se arregla insistiendo.
    if (/mime type .* is not supported/i.test(error.message)) {
      throw new Error(
        `${path}: el bucket no acepta ese tipo de archivo (${error.message}). ` +
          `Corre cualquier comando que llame a ensureBucket() para ampliarlo.`,
      );
    }

    if (/exceeded the maximum allowed size|Payload too large/i.test(error.message)) {
      throw new FileTooLargeError(
        `${path} pasa el límite de subida del proyecto ` +
          `(${(body.byteLength / 1048576).toFixed(0)} MB). Súbelo en Supabase → Storage → Settings.`,
      );
    }

    last = error.message || "sin detalle";
    if (attempt < UPLOAD_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, UPLOAD_BACKOFF_MS * attempt));
    }
  }

  throw new Error(`Subida fallida (${path}) tras ${UPLOAD_ATTEMPTS} intentos: ${last}`);
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
