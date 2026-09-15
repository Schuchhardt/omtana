/**
 * El render: de los audios de la sesión a un archivo que se puede subir.
 *
 * La escena es la del reproductor — fondo cálido que se mueve despacio, disco
 * que respira, onda que sigue la voz, el texto abajo y el wordmark arriba — y
 * se arma entera dentro de ffmpeg. Los únicos cuadros que se rasterizan aparte
 * son los del disco (`./disc`); todo lo demás son filtros, que es lo que
 * permite renderizar quince minutos sin escribir quince minutos de PNG.
 *
 * El fondo se dibuja chico y se agranda después: un degradado a 480×270 con un
 * desenfoque suave, escalado a 1080p, se ve igual que uno calculado a tamaño
 * completo y cuesta una fracción.
 */
import { join } from "node:path";
import { run, durationOf, FFMPEG_BIN } from "../generation/audio";
import { escapeText, ff, type Format, type Layout, type Theme } from "./brand";
import type { CardCopy } from "./copy";
import type { DiscTrack } from "./disc";

/* ───────────────────────── audio ───────────────────────── */

export interface TrackOptions {
  work: string;
  /** Las pistas de voz en orden: la respiración, si va, y la meditación. */
  voices: string[];
  /** Música de fondo, que se repite hasta cubrir la sesión. */
  music: string | null;
  musicVolume: number;
  /** Silencio al principio y al final, donde van las cartas del video largo. */
  introSeconds?: number;
  outroSeconds?: number;
  /**
   * Sufijo de los archivos de trabajo. Hace falta cuando se arma más de una
   * pista en la misma carpeta: la segunda lee la voz que dejó la primera, y sin
   * nombres distintos ffmpeg escribiría sobre el archivo que está leyendo.
   */
  label?: string;
}

/** Fundido de entrada y de salida de la música, en segundos. */
const MUSIC_FADE_IN = 6;
const MUSIC_FADE_OUT = 8;

/**
 * Deja una sola pista con todo lo que suena en el video.
 *
 * La app no mezcla la música dentro del archivo — la pone el reproductor, para
 * que cada persona la suba o la baje — pero un video no tiene mezclador: acá se
 * hornea, y por eso el volumen es un parámetro y no una constante escondida.
 */
export interface Track {
  /** Lo que se le entrega a ffmpeg: voz, música y recorte, ya mezclados. */
  file: string;
  seconds: number;
  /**
   * La misma voz sin música ni recorte. Es la que se mide para sincronizar los
   * subtítulos: sobre la mezcla, el fondo continuo borra los silencios que
   * separan una frase de la siguiente.
   */
  voice: string;
  voiceSeconds: number;
}

export async function buildTrack(opts: TrackOptions): Promise<Track> {
  const label = opts.label ?? "";
  const concatenated = join(opts.work, `voz${label}.wav`);

  if (opts.voices.length === 1) {
    await run(FFMPEG_BIN, ["-y", "-i", opts.voices[0], "-ac", "2", "-ar", "44100", concatenated]);
  } else {
    const inputs = opts.voices.flatMap((file) => ["-i", file]);
    const chain = opts.voices.map((_, i) => `[${i}:a]`).join("");
    await run(FFMPEG_BIN, [
      "-y", ...inputs,
      "-filter_complex", `${chain}concat=n=${opts.voices.length}:v=0:a=1[voz]`,
      "-map", "[voz]", "-ac", "2", "-ar", "44100",
      concatenated,
    ]);
  }

  let file = concatenated;
  let seconds = await durationOf(file);
  const voiceSeconds = seconds;

  const intro = opts.introSeconds ?? 0;
  const outro = opts.outroSeconds ?? 0;

  if (intro > 0 || outro > 0) {
    // El hueco va sobre la voz y antes de mezclar la música: así las cartas no
    // quedan mudas — la música empieza a sonar en la presentación y se apaga
    // sobre el cierre, que es lo que hace que el video no arranque en seco.
    const padded = join(opts.work, `voz-hueco${label}.wav`);
    await run(FFMPEG_BIN, [
      "-y", "-i", file,
      "-af", `adelay=${Math.round(intro * 1000)}:all=1,apad=pad_dur=${outro.toFixed(2)}`,
      padded,
    ]);
    file = padded;
    seconds = await durationOf(file);
  }

  if (opts.music && opts.musicVolume > 0) {
    const mixed = join(opts.work, `mezcla${label}.wav`);
    const fadeOut = Math.max(0, seconds - MUSIC_FADE_OUT);
    await run(FFMPEG_BIN, [
      "-y",
      "-i", file,
      // La música se repite: las pistas del banco duran dos o tres minutos y la
      // sesión quince. `duration=first` corta por la voz, no por la música.
      "-stream_loop", "-1", "-i", opts.music,
      "-filter_complex",
      `[1:a]volume=${opts.musicVolume.toFixed(2)},` +
        `afade=t=in:st=0:d=${MUSIC_FADE_IN},afade=t=out:st=${fadeOut.toFixed(2)}:d=${MUSIC_FADE_OUT}[fondo];` +
        // normalize=0 o amix baja las dos capas a la mitad y la voz queda lejos.
        `[0:a][fondo]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mezcla]`,
      "-map", "[mezcla]", "-t", seconds.toFixed(3),
      mixed,
    ]);
    file = mixed;
  }

  // `voice` es siempre la pista sin hueco ni música: los subtítulos se miden
  // sobre el reloj de la sesión, no sobre el del video.
  return { file, seconds, voice: concatenated, voiceSeconds };
}

/**
 * Un pedazo de la sesión, para las piezas de redes.
 *
 * Con fundido en los dos extremos: un recorte que empieza a mitad de una frase
 * y termina en seco suena a cinta cortada, aunque el contenido sea el correcto.
 */
export async function clipAudio(
  work: string,
  file: string,
  from: number,
  length: number,
  label: string,
): Promise<{ file: string; seconds: number }> {
  const out = join(work, `recorte-${label}.wav`);
  await run(FFMPEG_BIN, [
    "-y", "-ss", from.toFixed(3), "-t", length.toFixed(3), "-i", file,
    "-af", `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, length - 1.4).toFixed(2)}:d=1.4`,
    out,
  ]);
  return { file: out, seconds: await durationOf(out) };
}

/* ───────────────────────── video ───────────────────────── */

export interface RenderOptions {
  audio: string;
  seconds: number;
  disc: DiscTrack;
  logo: string;
  /** La rejilla de barras de `./disc`, para recortar el espectro. */
  barMask: string;
  subtitles: string | null;
  fontsDir: string;
  fontFile: string;
  format: Format;
  layout: Layout;
  theme: Theme;
  title: string;
  /** La línea chica: voz, duración, ejercicio. */
  meta: string;
  /** Presentación y cierre, solo en la pieza larga. */
  cards: CardOptions | null;
  out: string;
  /** Borrador rápido para mirar el encuadre; se nota en la compresión. */
  draft?: boolean;
}

export interface CardOptions {
  /** Segundos de presentación al principio y de cierre al final. */
  intro: number;
  outro: number;
  copy: CardCopy;
  /** El wordmark grande del cierre, ya rasterizado. */
  logo: string;
}

/** Alto de las barras en reposo, en píxeles. */
const REST_HEIGHT = 4;

/** Fundido de entrada y salida de la imagen. */
const FADE_IN = 1.6;
const FADE_OUT = 2.4;

export async function renderVideo(opts: RenderOptions): Promise<void> {
  const { format: f, layout: l, theme } = opts;
  const seconds = opts.seconds;

  /*
   * La sesión no ocupa el video entero cuando hay cartas: empieza donde
   * termina la presentación y termina donde empieza el cierre. Todo lo que es
   * "la escena" — onda, disco, título, barra — se enciende y se apaga en esa
   * ventana, y las cartas ocupan lo que queda.
   */
  const intro = opts.cards?.intro ?? 0;
  const outro = opts.cards?.outro ?? 0;
  const from = intro;
  const to = seconds - outro;
  /** Se le cuelga a cada capa de la escena para que no invada las cartas. */
  const inScene = opts.cards ? `:enable='between(t,${from},${to.toFixed(2)})'` : "";

  // El degradado se calcula a un cuarto del tamaño y se agranda: a esa escala
  // el desenfoque cuesta nada y el resultado es el mismo.
  //
  // El grano que va encima es fijo, no temporal (`allf=t`). Está para romper
  // las bandas del degradado, y para eso da igual que se mueva — pero moverse
  // le cuesta al codificador un 70% más de bits, porque cada cuadro deja de
  // parecerse al anterior justo donde no pasa nada.
  const bgW = Math.round(f.width / 4);
  const bgH = Math.round(f.height / 4);
  /** La onda se dibuja por mitades y se refleja, así que cada una va a medias. */
  const half = Math.round(l.waveHeight / 2);

  const filters: string[] = [
    `gradients=s=${bgW}x${bgH}:c0=${ff(theme.backgroundDeep)}:c1=${ff(theme.background)}:` +
      `c2=${ff(theme.glow)}:x0=${Math.round(bgW * 0.2)}:y0=${Math.round(bgH * 0.8)}:` +
      `x1=${Math.round(bgW * 0.9)}:y1=${Math.round(bgH * 0.1)}:nb_colors=3:` +
      // Lentísimo a propósito: se tiene que notar recién al volver a mirar.
      `speed=0.0006:type=radial:seed=7:r=30:d=${Math.ceil(seconds)}[grad]`,
    `[grad]gblur=sigma=12,scale=${f.width}:${f.height}:flags=bicubic,` +
      `vignette=PI/5,noise=alls=4,format=rgba[bg]`,

    /*
     * La onda de la voz, igual que en el reproductor: barras separadas que
     * siguen el espectro, simétricas respecto del centro.
     *
     * ffmpeg no sabe dibujar barras sueltas — `showfreqs` da una silueta
     * continua — así que el espectro se calcula a tantos píxeles de ancho como
     * barras hay, se estira sin interpolar (cada píxel es una barra), y se usa
     * como transparencia de un rectángulo del color de la marca. La rejilla
     * abre los huecos entre barra y barra, y el reflejo vertical da la mitad
     * de abajo.
     */
    `[0:a]showfreqs=s=${l.waveBars}x${half}:mode=bar:ascale=log:fscale=log:` +
      `win_size=2048:colors=white,scale=${l.waveWidth}:${half}:flags=neighbor,format=gray[energia]`,
    `[3:v]split=2[rejillaOnda][rejillaReposo]`,
    `[rejillaOnda]scale=${l.waveWidth}:${half},format=gray[rejilla]`,
    `[energia][rejilla]blend=all_mode=multiply:shortest=1[mascara]`,
    `color=c=${ff(theme.wave)}:s=${l.waveWidth}x${half}:r=30[color]`,
    `[color][mascara]alphamerge,colorchannelmixer=aa=0.45[media]`,
    `[media]split[arriba][abajo]`,
    `[abajo]vflip[reflejo]`,
    `[arriba][reflejo]vstack=inputs=2[onda]`,
    `[bg][onda]overlay=x=(W-w)/2:y=${l.centerY}-h/2:shortest=1${inScene}[conOnda]`,

    // Las barras en reposo: una fila finita que se ve siempre, como en el
    // reproductor cuando está en pausa. Sin ella, en los silencios largos del
    // guion la onda desaparece entera y el centro queda vacío.
    `[rejillaReposo]scale=${l.waveWidth}:${REST_HEIGHT},format=gray[rejillaBase]`,
    `color=c=${ff(theme.wave)}:s=${l.waveWidth}x${REST_HEIGHT}:r=30[colorBase]`,
    `[colorBase][rejillaBase]alphamerge,colorchannelmixer=aa=0.2[reposo]`,
    `[conOnda][reposo]overlay=x=(W-w)/2:y=${l.centerY}-${Math.round(REST_HEIGHT / 2)}:shortest=1${inScene}[escena]`,

    // El disco dura lo que dura la sesión, así que con cartas hay que correrlo
    // hasta donde la sesión empieza; si no, respira durante la presentación y
    // se queda quieto al final.
    `[1:v]fps=30${intro > 0 ? `,setpts=PTS+${intro}/TB` : ""},format=rgba[disco]`,
    `[escena][disco]overlay=x=(W-w)/2:y=${l.centerY}-h/2${inScene}[conDisco]`,

    // El wordmark chico se retira en el cierre: ahí el logo grande es el tema.
    `[2:v]format=rgba,colorchannelmixer=aa=0.66[logo]`,
    `[conDisco][logo]overlay=x=${l.logoX}:y=${l.logoY}` +
      `${opts.cards ? `:enable='lt(t,${to.toFixed(2)})'` : ""}[marca]`,
  ];

  let last = "marca";

  const title = `[${last}]drawtext=fontfile='${opts.fontFile}':text='${escapeText(opts.title)}':` +
    `fontcolor=${ff(theme.text)}:fontsize=${l.titleSize}:x=(w-text_w)/2:y=${l.titleY}${inScene}[titulo]`;
  const meta = `[titulo]drawtext=fontfile='${opts.fontFile}':text='${escapeText(opts.meta)}':` +
    `fontcolor=${ff(theme.textFaint)}:fontsize=${l.metaSize}:x=(w-text_w)/2:y=${l.metaY}${inScene}[meta]`;
  filters.push(title, meta);
  last = "meta";

  // La barra de progreso: el riel entero y encima lo recorrido, que se dibuja
  // con el ancho evaluado en cada cuadro.
  const barX = `(${f.width}-${l.barWidth})/2`;
  // La barra mide la sesión, no el archivo: llena cuando la voz termina, no
  // cuando termina el cierre.
  const played = `min(1,max(0,(t-${from})/${Math.max(1, to - from).toFixed(2)}))`;
  filters.push(
    `[${last}]drawbox=x=${barX}:y=${l.barY}:w=${l.barWidth}:h=${l.barHeight}:` +
      `color=${ff(theme.barTrack)}@0.9:t=fill${inScene}[riel]`,
    `[riel]drawbox=x=${barX}:y=${l.barY}:w='${l.barWidth}*${played}':` +
      `h=${l.barHeight}:color=${ff(theme.bar)}:t=fill${inScene}[barra]`,
  );
  last = "barra";

  if (opts.cards) last = drawCards(filters, last, opts, from, to);

  if (opts.subtitles) {
    filters.push(
      `[${last}]subtitles=filename='${escapePath(opts.subtitles)}':` +
        `fontsdir='${escapePath(opts.fontsDir)}'[subs]`,
    );
    last = "subs";
  }

  filters.push(
    `[${last}]fade=t=in:st=0:d=${FADE_IN},` +
      `fade=t=out:st=${Math.max(0, seconds - FADE_OUT).toFixed(2)}:d=${FADE_OUT},` +
      `format=yuv420p[salida]`,
  );

  await run(FFMPEG_BIN, [
    "-y",
    "-i", opts.audio,
    "-f", "concat", "-safe", "0", "-i", opts.disc.concatFile,
    "-loop", "1", "-i", opts.logo,
    "-loop", "1", "-i", opts.barMask,
    ...(opts.cards ? ["-loop", "1", "-i", opts.cards.logo] : []),
    "-filter_complex", filters.join(";"),
    "-map", "[salida]", "-map", "0:a",
    "-t", seconds.toFixed(3),
    "-c:v", "libx264",
    "-preset", opts.draft ? "ultrafast" : "medium",
    "-crf", opts.draft ? "28" : "20",
    "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
    "-movflags", "+faststart",
    opts.out,
  ]);
}

/* ───────────────────────── cartas ───────────────────────── */

/**
 * La presentación y el cierre.
 *
 * Son texto sobre el mismo fondo, no otra escena: el degradado sigue
 * moviéndose y la música sigue sonando, así que el video no arranca en seco ni
 * termina en corte. Cada línea entra y sale con un fundido propio, porque
 * aparecer de golpe en un video de meditación se siente como un anuncio.
 *
 * Qué dice la de entrada está decidido por lo que necesita saber alguien que
 * acaba de llegar y está decidiendo si se queda: de qué es la sesión, cuánto
 * dura, y si abre con respiración guiada o entra directo al cuerpo.
 */
function drawCards(
  filters: string[],
  last: string,
  opts: RenderOptions,
  from: number,
  to: number,
): string {
  const { layout: l, format: f, theme } = opts;
  const card = opts.cards!;
  let cursor = last;
  let n = 0;

  const line = (
    text: string,
    y: number,
    size: number,
    color: string,
    alpha: string,
    enable: string,
  ) => {
    if (!text) return;
    const next = `carta${n++}`;
    filters.push(
      `[${cursor}]drawtext=fontfile='${opts.fontFile}':text='${escapeText(text)}':` +
        `fontcolor=${ff(color)}:fontsize=${Math.round(size)}:x=(w-text_w)/2:y=${Math.round(y)}:` +
        `alpha='${alpha}':enable='${enable}'[${next}]`,
    );
    cursor = next;
  };

  /* ── presentación ── */
  const introAlpha = fadeAlpha(0.5, from - 0.4);
  const introOn = `lt(t,${from})`;

  line(card.copy.title, f.height * 0.33, l.titleSize * 1.3, theme.text, introAlpha, introOn);

  const summary = wrapCard(card.copy.summary, 54);
  summary.forEach((text, i) => {
    line(
      text,
      f.height * (0.44 + i * 0.05),
      l.metaSize * 1.45,
      theme.textSoft,
      introAlpha,
      introOn,
    );
  });

  line(card.copy.sheet, f.height * 0.6, l.metaSize * 1.15, theme.textFaint, introAlpha, introOn);
  line(
    card.copy.breathing,
    f.height * 0.645,
    l.metaSize * 1.15,
    theme.textFaint,
    introAlpha,
    introOn,
  );

  /* ── cierre ── */
  const outroAlpha = fadeAlpha(to + 0.4, opts.seconds - 0.5);
  const outroOn = `gte(t,${to.toFixed(2)})`;

  // El wordmark grande, que es lo único que se ve completo del cierre.
  const logo = `logoCierre`;
  filters.push(
    `[4:v]format=rgba,colorchannelmixer=aa=0.9,` +
      `fade=t=in:st=${(to + 0.4).toFixed(2)}:d=0.9:alpha=1[${logo}]`,
    `[${cursor}][${logo}]overlay=x=(W-w)/2:y=${Math.round(f.height * 0.33)}:` +
      `enable='${outroOn}'[conLogo]`,
  );
  cursor = "conLogo";

  line(card.copy.closing, f.height * 0.55, l.metaSize * 1.2, theme.textFaint, outroAlpha, outroOn);
  line(card.copy.site, f.height * 0.595, l.titleSize * 1.15, theme.text, outroAlpha, outroOn);
  line(card.copy.invite, f.height * 0.69, l.metaSize * 1.15, theme.textFaint, outroAlpha, outroOn);

  return cursor;
}

/** Entra en ochenta centésimas, se queda, y se va igual de despacio. */
function fadeAlpha(start: number, end: number): string {
  const d = 0.8;
  return (
    `if(lt(t,${start.toFixed(2)}),0,` +
    `if(lt(t,${(start + d).toFixed(2)}),(t-${start.toFixed(2)})/${d},` +
    `if(lt(t,${(end - d).toFixed(2)}),1,` +
    `if(lt(t,${end.toFixed(2)}),(${end.toFixed(2)}-t)/${d},0))))`
  );
}

/** Dos líneas como mucho: una carta no es un párrafo. */
function wrapCard(text: string, max: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const words = clean.split(" ");
  const half = Math.ceil(clean.length / 2);
  let cut = words.length - 1;
  let best = Infinity;

  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(" ").length - half);
    if (diff < best) {
      best = diff;
      cut = i;
    }
  }

  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

/**
 * Dentro de un filtro, ffmpeg vuelve a parsear el argumento: los dos puntos
 * separan opciones y la comilla cierra el valor. Las rutas de este proyecto no
 * suelen tener ninguno de los dos, pero una carpeta con un ":" rompería el
 * render entero sin decir por qué.
 */
function escapePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
