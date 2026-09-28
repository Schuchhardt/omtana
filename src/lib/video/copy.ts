/**
 * Lo que acompaña al video cuando se sube: título, descripción, capítulos y
 * etiquetas.
 *
 * Se arma acá y se guarda con el export (`metadata`), no al momento de subir:
 * así el archivo y su ficha viajan juntos, y volver a subirlo — o subirlo desde
 * otra máquina — no depende de recalcular nada.
 *
 * Es texto plantillado a propósito. Pedirle a un modelo un título por video
 * cuesta y, sobre todo, hace que dos videos de la misma serie no se parezcan
 * entre sí, que es justo lo que un canal necesita que pase.
 */
import { formatClock } from "../format";
import type { FormatId } from "./brand";

export interface CopyInput {
  title: string;
  intentionSummary: string;
  locale: string;
  voiceName: string;
  durationMinutes: number;
  breathingName: string | null;
  format: FormatId;
  /** Qué lleva la pieza: la sesión entera, la respiración o un pasaje. */
  piece: "completa" | "respiracion" | "meditacion";
  /** Rótulo y segundo de arranque de cada tramo, para los capítulos. */
  chapters: { at: number; label: string }[];
}

export interface VideoCopy {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
}

/**
 * Lo que dicen las cartas de entrada y de cierre del video largo.
 *
 * La de entrada existe porque quien llega a un video de quince minutos decide
 * en los primeros diez segundos si se queda, y lo que necesita saber es qué va
 * a pasar: de qué es la sesión, cuánto dura y si abre con respiración guiada o
 * entra directo al cuerpo. La de cierre es la única parte del video donde
 * Omtana habla de sí misma.
 */
export interface CardCopy {
  title: string;
  summary: string;
  /** "15 minutos · Voz: Aurora" */
  sheet: string;
  /** Si abre con respiración guiada, y con cuál. */
  breathing: string;
  site: string;
  closing: string;
  invite: string;
}

export interface CardInput {
  title: string;
  intentionSummary: string;
  locale: string;
  voiceName: string;
  durationMinutes: number;
  breathingName: string | null;
  breathingSeconds: number;
}

/**
 * El dominio de la marca, que no es la URL del despliegue.
 *
 * `NEXT_PUBLIC_SITE_URL` en una máquina de desarrollo es `localhost:3000`, y eso
 * no puede terminar impreso en un video que se sube a un canal público.
 */
export const SITE = "omtana.com";

export function cardCopy(input: CardInput): CardCopy {
  const s = STRINGS[input.locale] ?? STRINGS.es;
  const withBreathing = Boolean(input.breathingName) && input.breathingSeconds > 0;

  return {
    title: input.title,
    summary: input.intentionSummary.trim(),
    // La carta cuenta el orden de lo que viene: primero el ejercicio, después
    // la meditación. Quien llega decide con eso si se queda.
    sheet: withBreathing
      ? `${s.thenMeditation(bodyMinutes(input))} · ${s.guidedBy(input.voiceName)}`
      : `${s.minutes(input.durationMinutes)} · ${s.guidedBy(input.voiceName)}`,
    breathing: withBreathing
      ? // En reloj y no en minutos redondos: la respiración dura dos y medio,
        // y "3 min" en la carta promete medio minuto que no existe.
        s.opensWith(input.breathingName!, formatClock(input.breathingSeconds))
      : s.noBreathing,
    site: SITE,
    closing: s.closing,
    invite: s.invite,
  };
}

/**
 * Lo que la voz dice sobre la presentación.
 *
 * Once segundos de carta muda eran once segundos de silencio al principio del
 * video, que es donde más gente se va. La misma voz de la sesión explica qué
 * viene — el ejercicio primero, la meditación después — y la carta lo muestra
 * escrito mientras tanto.
 */
export function introSpeech(input: CardInput): string {
  const s = STRINGS[input.locale] ?? STRINGS.es;
  const title = lowerFirst(input.title.trim().replace(/[.…]+$/, ""));

  if (input.breathingName && input.breathingSeconds > 0) {
    return s.speech(
      spokenName(input.breathingName),
      s.clockWords(input.breathingSeconds),
      bodyMinutes(input),
      title,
    );
  }
  return s.speechNoBreathing(input.durationMinutes, title);
}

/**
 * Cómo se dice el ejercicio.
 *
 * "Caja 4-4-4-4" leído por la voz es "caja cuatro cuatro cuatro cuatro": se
 * queda con la palabra. Un nombre que es solo números ("4-7-8") se lee con
 * pausas, "4, 7, 8", que es como lo dice cualquiera.
 */
function spokenName(name: string): string {
  const words = name.replace(/[\d\-–·\s]+/g, " ").trim();
  return words ? words.toLowerCase() : name.replace(/-/g, ", ");
}

/** Los minutos de meditación propiamente tal, descontado el ejercicio. */
function bodyMinutes(input: CardInput): number {
  return Math.max(1, Math.round((input.durationMinutes * 60 - input.breathingSeconds) / 60));
}

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

/** "dos minutos y medio": la voz no lee "2:30". */
function minutesInWords(seconds: number, words: string[], minute: string, minutes: string, half: string): string {
  const whole = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const n = words[whole] ?? String(whole);
  const unit = whole === 1 ? minute : minutes;
  return rest >= 20 && rest <= 40 ? `${n} ${unit} ${half}` : `${n} ${unit}`;
}

interface Strings {
  suffix: (minutes: number) => string;
  minutes: (n: number) => string;
  opensWith: (name: string, clock: string) => string;
  /** "Después, 18 minutos de meditación". */
  thenMeditation: (minutes: number) => string;
  /** Lo que la voz dice en la presentación. */
  speech: (breathingName: string, clockWords: string, minutes: number, title: string) => string;
  speechNoBreathing: (minutes: number, title: string) => string;
  clockWords: (seconds: number) => string;
  noBreathing: string;
  closing: string;
  invite: string;
  breathingTitle: (name: string) => string;
  /** Lo que se dice cuando la pieza **es** el ejercicio, no cuando lo abre. */
  breathingPiece: (name: string) => string;
  excerpt: string;
  guidedBy: (voice: string) => string;
  breathing: (name: string) => string;
  chaptersTitle: string;
  about: string;
  disclaimer: string;
  site: string;
  tags: string[];
  hashtags: string[];
  shortTag: string;
}

const STRINGS: Record<string, Strings> = {
  es: {
    suffix: (m) => `Meditación guiada de ${m} minutos`,
    minutes: (n) => `${n} minutos`,
    opensWith: (n, c) => `Primero, respiración guiada ${n} · ${c}`,
    thenMeditation: (m) => `Después, ${m} minutos de meditación`,
    speech: (n, c, m, t) =>
      `Esta sesión abre con ${c} de respiración ${n}. ` +
      `Después, una meditación de ${m} minutos para ${t}.`,
    speechNoBreathing: (m, t) =>
      `Esta es una meditación guiada de ${m} minutos para ${t}. Entra directo al cuerpo.`,
    clockWords: (s) =>
      minutesInWords(s, ["cero", "un", "dos", "tres", "cuatro", "cinco"], "minuto", "minutos", "y medio"),
    noBreathing: "Sin ejercicio de respiración: entra directo al cuerpo",
    closing: "Esta y más meditaciones en",
    invite: "O genera la tuya, con tu intención y tu contexto",
    breathingTitle: (n) => `Respiración ${n}`,
    breathingPiece: (n) =>
      `Un ciclo completo de respiración ${n}, para repetirlo las veces que quieras. ` +
      `Las meditaciones que abren con él están en el canal.`,
    excerpt: "Un tramo de una meditación guiada de Omtana. La sesión completa está en el canal.",
    guidedBy: (v) => `Voz: ${v}`,
    breathing: (n) => `Empieza con respiración guiada ${n}.`,
    chaptersTitle: "Capítulos",
    about:
      "Omtana escribe cada meditación a partir de una intención concreta. " +
      "Esta se generó con guion propio, voz del banco y música de fondo.",
    disclaimer:
      "Esto no reemplaza atención médica ni psicológica. Si estás pasando por una crisis, busca ayuda profesional.",
    site: "Crea la tuya en",
    tags: ["meditación guiada", "meditación", "respiración guiada", "relajación", "mindfulness", "omtana"],
    hashtags: ["#meditación", "#respiración", "#calma", "#omtana"],
    shortTag: "#Shorts",
  },
  en: {
    suffix: (m) => `${m}-minute guided meditation`,
    minutes: (n) => `${n} minutes`,
    opensWith: (n, c) => `First, guided ${n} breathing · ${c}`,
    thenMeditation: (m) => `Then, ${m} minutes of meditation`,
    speech: (n, c, m, t) =>
      `This session opens with ${c} of ${n} breathing. ` +
      `Then, a ${m}-minute meditation to ${t}.`,
    speechNoBreathing: (m, t) =>
      `This is a ${m}-minute guided meditation to ${t}. It goes straight into the body.`,
    clockWords: (s) =>
      minutesInWords(s, ["zero", "one", "two", "three", "four", "five"], "minute", "minutes", "and a half")
        .replace(/(\w+) minutes and a half/, "$1 and a half minutes"),
    noBreathing: "No breathing exercise: straight into the body",
    closing: "This and more meditations at",
    invite: "Or make your own, from your intention and your context",
    breathingTitle: (n) => `${n} breathing`,
    breathingPiece: (n) =>
      `One full cycle of ${n} breathing, to repeat as many times as you like. ` +
      `The meditations that open with it are on the channel.`,
    excerpt: "One passage from an Omtana guided meditation. The full session is on the channel.",
    guidedBy: (v) => `Voice: ${v}`,
    breathing: (n) => `Opens with guided breathing: ${n}.`,
    chaptersTitle: "Chapters",
    about:
      "Omtana writes every meditation around one concrete intention. " +
      "This one was generated with its own script, a voice from the bank and background music.",
    disclaimer:
      "This does not replace medical or psychological care. If you are in crisis, reach out to a professional.",
    site: "Make your own at",
    tags: ["guided meditation", "meditation", "breathwork", "relaxation", "mindfulness", "omtana"],
    hashtags: ["#meditation", "#breathwork", "#calm", "#omtana"],
    shortTag: "#Shorts",
  },
  pt: {
    suffix: (m) => `Meditação guiada de ${m} minutos`,
    minutes: (n) => `${n} minutos`,
    opensWith: (n, c) => `Primeiro, respiração guiada ${n} · ${c}`,
    thenMeditation: (m) => `Depois, ${m} minutos de meditação`,
    speech: (n, c, m, t) =>
      `Esta sessão começa com ${c} de respiração ${n}. ` +
      `Depois, uma meditação de ${m} minutos para ${t}.`,
    speechNoBreathing: (m, t) =>
      `Esta é uma meditação guiada de ${m} minutos para ${t}. Entra direto no corpo.`,
    clockWords: (s) =>
      minutesInWords(s, ["zero", "um", "dois", "três", "quatro", "cinco"], "minuto", "minutos", "e meio"),
    noBreathing: "Sem exercício de respiração: entra direto no corpo",
    closing: "Esta e mais meditações em",
    invite: "Ou crie a sua, a partir da sua intenção e do seu contexto",
    breathingTitle: (n) => `Respiração ${n}`,
    breathingPiece: (n) =>
      `Um ciclo completo de respiração ${n}, para repetir quantas vezes quiser. ` +
      `As meditações que começam com ele estão no canal.`,
    excerpt: "Um trecho de uma meditação guiada da Omtana. A sessão completa está no canal.",
    guidedBy: (v) => `Voz: ${v}`,
    breathing: (n) => `Começa com respiração guiada ${n}.`,
    chaptersTitle: "Capítulos",
    about:
      "A Omtana escreve cada meditação a partir de uma intenção concreta. " +
      "Esta foi gerada com roteiro próprio, voz do banco e música de fundo.",
    disclaimer:
      "Isto não substitui atendimento médico ou psicológico. Se você está em crise, procure ajuda profissional.",
    site: "Crie a sua em",
    tags: ["meditação guiada", "meditação", "respiração guiada", "relaxamento", "mindfulness", "omtana"],
    hashtags: ["#meditação", "#respiração", "#calma", "#omtana"],
    shortTag: "#Shorts",
  },
};

/**
 * La frase del llamado a la acción, sin el enlace: "Crea la tuya en". La usa
 * la publicación a redes para reconocer la línea en una ficha ya guardada y
 * para reponerla si el recorte de caracteres se la llevó.
 */
export function siteCta(locale: string): string {
  return (STRINGS[locale] ?? STRINGS.es).site;
}

/** YouTube corta el título en 100 caracteres y la descripción en 5000. */
const TITLE_MAX = 100;

export function videoCopy(input: CopyInput): VideoCopy {
  const s = STRINGS[input.locale] ?? STRINGS.es;
  const vertical = input.format !== "youtube";

  // El título dice lo que se ve. Un ejercicio de respiración publicado con el
  // título de la meditación de la que salió promete otra cosa y se nota.
  const headline =
    input.piece === "respiracion" && input.breathingName
      ? s.breathingTitle(input.breathingName)
      : input.title;

  const title = clip(
    vertical
      ? `${headline} · ${s.shortTag}`
      : `${input.title} · ${s.suffix(input.durationMinutes)}`,
    TITLE_MAX,
  );

  const lines: string[] = [];
  const summary = input.intentionSummary.trim();
  if (summary) lines.push(summary, "");

  lines.push(s.guidedBy(input.voiceName));

  // Qué es esto, que no es lo mismo en las tres piezas: la sesión entera abre
  // con el ejercicio, el recorte de respiración **es** el ejercicio, y el de
  // meditación es un tramo de algo más largo.
  if (input.piece === "meditacion") {
    lines.push(s.excerpt);
  } else if (input.breathingName) {
    lines.push(
      input.piece === "respiracion"
        ? s.breathingPiece(input.breathingName)
        : s.breathing(input.breathingName),
    );
  }
  lines.push("");

  // Los capítulos solo tienen sentido en la pieza larga: YouTube los ignora en
  // Shorts, y en un recorte de un minuto sobran.
  const chapters = usableChapters(input.chapters);
  if (!vertical && chapters.length >= 3) {
    lines.push(s.chaptersTitle);
    for (const chapter of chapters) {
      lines.push(`${clock(chapter.at)} ${chapter.label}`);
    }
    lines.push("");
  }

  lines.push(s.about, "");
  lines.push(`${s.site} ${siteUrl()}`, "");
  lines.push(s.disclaimer, "");
  lines.push([...s.hashtags, ...(vertical ? [s.shortTag] : [])].join(" "));

  return {
    title,
    description: lines.join("\n").slice(0, 4900),
    tags: s.tags,
    hashtags: s.hashtags,
  };
}

/**
 * El primer capítulo de YouTube tiene que arrancar en 0:00 y ninguno puede
 * durar menos de diez segundos; si uno solo incumple, YouTube no muestra
 * ninguno. Por eso se filtran acá en vez de confiar en el reparto.
 */
function usableChapters(chapters: CopyInput["chapters"]): CopyInput["chapters"] {
  const sorted = [...chapters].sort((a, b) => a.at - b.at);
  if (sorted.length === 0 || sorted[0].at !== 0) return [];

  const out: CopyInput["chapters"] = [sorted[0]];
  for (const chapter of sorted.slice(1)) {
    if (chapter.at - out[out.length - 1].at >= 10) out.push(chapter);
  }
  return out;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * El enlace que va en la descripción.
 *
 * `||` y no `??` porque en Actions una variable sin definir llega como cadena
 * vacía. Y una URL de desarrollo se descarta: el video se sube a un canal
 * público y "localhost:3000" ahí no le sirve a nadie.
 */
function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || "";
  if (!url || /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) return `https://${SITE}`;
  return url;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
