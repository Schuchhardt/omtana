const API = "https://api.elevenlabs.io/v1";

/** Modelo multilingüe: la misma voz sirve para ES, EN y PT. */
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

export interface SynthesisOptions {
  voiceId: string;
  text: string;
  settings?: Record<string, number>;
}

/** Intentos ante un fallo de red, y cuánto se espera entre ellos. */
const ATTEMPTS = 3;
const BACKOFF_MS = 2000;

/**
 * Graba un texto con una voz.
 *
 * Reintenta los cortes de red — grabar un banco entero son cientos de llamadas
 * seguidas y alguna se cae sola — pero no los rechazos del servicio: si la voz
 * está deshabilitada o la clave no sirve, insistir solo tarda más en decirlo.
 */
export async function synthesize({
  voiceId,
  text,
  settings,
}: SynthesisOptions): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Falta ELEVENLABS_API_KEY.");

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: settings?.stability ?? 0.45,
            similarity_boost: settings?.similarity_boost ?? 0.75,
            style: settings?.style ?? 0,
            speed: settings?.speed ?? 0.82,
            use_speaker_boost: true,
          },
        }),
      });
    } catch (err) {
      if (attempt >= ATTEMPTS) {
        throw new Error(
          `No se pudo hablar con ElevenLabs tras ${ATTEMPTS} intentos: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
      continue;
    }

    if (res.ok) return Buffer.from(await res.arrayBuffer());

    const detail = await res.text().catch(() => "");
    // 429 y 5xx son "vuelve más tarde"; el resto es una respuesta, no un tropiezo.
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt >= ATTEMPTS) {
      throw new Error(`ElevenLabs respondió ${res.status}: ${detail.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
  }
}

export async function listProviderVoices(): Promise<
  { voice_id: string; name: string; labels: Record<string, string> }[]
> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Falta ELEVENLABS_API_KEY.");

  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key } });
  if (!res.ok) throw new Error(`ElevenLabs respondió ${res.status}`);

  const body = (await res.json()) as {
    voices: { voice_id: string; name: string; labels: Record<string, string> }[];
  };
  return body.voices;
}
