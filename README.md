# Omtana

Meditaciones generadas a partir de la intención de cada persona: guion escrito
para el caso, voz elegida de un banco de actores y música propia de fondo.

La arquitectura es **plantilla + tramos**. Cada intención tiene una plantilla con
el audio ya pregenerado; sobre esa base se intercalan los minutos escritos para
quien pide la sesión. De una meditación de quince minutos, once ya existen y
cuatro se generan al vuelo — por eso la espera es corta y el costo es bajo.

```
Respiración 4-7-8   2 min   pregenerado
Entrada al cuerpo   2 min   pregenerado
Tu contexto         4 min   ← escrito para esta persona
Refuerzo e imágenes 5 min   pregenerado
Cierre              2 min   pregenerado
```

## Stack

| Capa | Elección |
|---|---|
| App | Next.js 16 (App Router) · React 19 · Tailwind v4 |
| Base de datos | Supabase Postgres, **sin RLS y sin Supabase Auth** |
| Acceso a datos | Service role key, siempre desde el servidor |
| Sesiones | Cookie httpOnly propia, contraseñas con `scrypt` |
| Guion | Claude (`claude-opus-5`) con salida estructurada |
| Voz | ElevenLabs multilingüe |
| Música | Banco propio (Suno), subido al bucket de audio |
| Audio y video | ffmpeg |
| Pagos | Stripe (créditos y suscripción Pro) |

Todas las tablas llevan prefijo `omtana_`.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # completa las claves
npm run setup                  # migraciones + banco curado
npm run voices:link -- --auto  # enlaza las voces con ElevenLabs
npm run samples                # graba las muestras del banco de voces
npm run respiracion -- --voz aurora   # graba los ejercicios de respiración
npm run dev
```

La app arranca y se puede recorrer entera aunque Supabase todavía no esté
conectado: muestra un aviso arriba y estados vacíos con el comando que falta.

Necesitas `ffmpeg` y `ffprobe` en el PATH (`brew install ffmpeg`).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run db:push` | Aplica `supabase/migrations/`. `-- --solo 0004` aplica solo esa (las migraciones no llevan registro, así que el directorio entero falla sobre una base viva). `-- --print` escupe el SQL para pegarlo en el editor de Supabase. |
| `npm run seed` | Carga voces, intenciones, ejercicios de respiración y la música que encuentre en `assets/music/`. Idempotente. |
| `npm run voices:link` | Muestra el estado del enlace con ElevenLabs. `-- --auto` asigna por orden; `-- aurora=<voice_id>` asigna una. |
| `npm run samples` | Graba la muestra de 12 s de cada voz. `-- --all` las rehace todas. |
| `npm run respiracion` | Graba y verifica los ejercicios de respiración de una voz. Ver abajo. |
| `npm run generate` | Genera meditaciones. Ver abajo. |
| `npm run curaduria` | Qué le falta al banco para estar parejo. Ver abajo. |
| `npm run video` | Renderiza las piezas de video: 16:9, 9:16 y 1:1. Ver abajo. |
| `npm run youtube` | Sube al canal lo que ya está renderizado. Privado salvo que se diga otra cosa. |
| `npm run ci` | Las tandas automáticas (`meditaciones`, `videos`) como una sola orden. Es lo que corre GitHub Actions. |
| `npm run icons` | Rehace los PNG del manifiesto desde el símbolo de la marca. Solo cuando cambia el símbolo. |

### Generar meditaciones

```bash
# Una, a partir de una intención del banco
npm run generate -- --i dormir-sin-dar-vueltas --duracion 10 --voz aurora

# Una, con intención y contexto libres
npm run generate -- \
  --intencion "Mejorar mi salud" \
  --contexto "Dieta sin gluten hace tres meses, me cuesta el fin de semana" \
  --duracion 15 --voz aurora --respiracion caja-4-4-4-4

# Las que más falta le hacen al banco, en orden de desequilibrio
npm run generate -- --faltantes 3

# El banco inicial completo, público en el catálogo
npm run generate -- --curated

# Reintentar lo que falló
npm run generate -- --retry
```

Opciones: `--intencion`, `--i <slug>`, `--contexto`, `--duracion 5|10|15|20`,
`--voz <slug>`, `--respiracion <slug>|ninguna`, `--sin-respiracion`,
`--idioma es|en|pt`, `--privada`, `--musica <slug>`, `--faltantes <n>`.

`--faltantes` es `--curated` al revés. `--curated` recorre el banco de arriba
abajo, así que termina llenando primero el área que ya estaba llena — es la que
viene primero en la lista. `--faltantes` le pregunta a la curaduría qué falta y
empieza por el área con menos cobertura, así que tres por corrida emparejan el
catálogo sin que nadie lleve la cuenta.

La música ya no se mezcla dentro del archivo: el reproductor la pone en vivo,
con su propio volumen, así que cada persona la sube, la baja o la cambia sin
regenerar nada. `--musica` existe para casos puntuales (un video, por ejemplo),
pero lo normal es generar la sesión seca.

Lo que generas desde el CLI va al catálogo público: no tiene usuario dueño, así
que dejarlo privado lo volvería invisible. `--privada` existe igual, con aviso.

La primera meditación de una intención paga la plantilla (bloques fijos escritos
y sintetizados una vez). Las siguientes con esa misma intención, duración, idioma
y voz reutilizan ese audio y solo generan el tramo personalizado.

### Respiración

La respiración no es un bloque del guion: es una grilla de tiempo. Inhalar
cuatro segundos son cuatro segundos de reloj, y el conteo del tercero cae en el
tercero. Leída por la voz de corrido eso no se cumple — el "uno" y el "dos"
calzan y el "tres" y el "cuatro" se apuran — así que el audio se arma pegando
cada señal en su milisegundo sobre una base de silencio, y después se vuelve a
medir el archivo para comprobarlo.

```bash
npm run respiracion -- --listar                     # el banco y lo que dura cada uno
npm run respiracion -- --guion --ejercicio 4-7-8    # la grilla, sin gastar nada
npm run respiracion -- --voz aurora                 # graba lo que le falte a esa voz
npm run respiracion -- --voz todas                  # el banco entero, cada voz en sus idiomas
npm run respiracion -- --voz aurora --verificar     # mide los audios ya grabados
npm run respiracion -- --limpiar                    # borra lo grabado para huecos que ya no existen
npm run respiracion -- --voz aurora --guardar assets/respiracion   # copia local para escucharla
```

Sin `--idioma` cada voz se graba en los idiomas que declara hablar: las señales
en español con una voz inglesa dan un acento que no se arregla después. Volver a
correrlo salta lo que ya existe, así que es la forma de reponer lo que haya
fallado.

Opciones: `--voz <slug>|todas`, `--ejercicio <slug>`, `--idioma es|en|pt|todos`,
`--hueco 120|150`, `--rehacer`, `--regrabar`, `--verificar`, `--guardar <dir>`.

`--rehacer` vuelve a armar el ejercicio reutilizando las señales ya grabadas y
no cuesta síntesis; `--regrabar` las graba de nuevo. Cambiar la mezcla o los
tiempos es lo primero, cambiar el texto es lo segundo.

Cada palabra ("inhala", "sostén", los números) se sintetiza **una sola vez por
voz e idioma** y se reutiliza en todos los ejercicios, así que sumar un
ejercicio al banco no cuesta síntesis si usa el mismo vocabulario.

Para que no suene a máquina, cada palabra se graba en seis tomas — cambia la
puntuación con la que se le pide a la voz, y con ella la entonación — y la toma
rota por ciclo, así que ningún ciclo repite la grabación de otro. Las
instrucciones además rotan entre cuatro maneras de pedir lo mismo ("inhala" /
"inspira" / "toma aire" / "deja entrar el aire"). Entre ciclo y ciclo hay un
respiro donde caen los comentarios que acompañan: "vas bien", "quedan dos",
"la última".

Si una palabra te suena mal, `--pronunciar "siete,siéte,ciete"` graba las
grafías que le pases — una por archivo y todas juntas — para elegir a oído; la
ganadora va a `pronounce` en `src/lib/breathing.ts`, que reescribe lo que se le
manda a la voz sin tocar lo que dice el guion. Con `--en-frase` las graba dentro
de "Cinco. Seis. …" y recorta la última palabra: hay palabras que la voz solo
pronuncia bien en contexto, y así se queda la buena aunque suelta salga mal.

Las copias locales van a `assets/respiracion/`, que no se versiona.

`counting` decide cuánto se cuenta, y de ahí sale el ritmo. Contar cada segundo
obliga a decir cada palabra en menos de un segundo, y a ese ritmo la voz suena
apurada: `last` deja solo el hito final de cada fase ("Inhala… cuatro") y el
silencio entre medio es lo que permite decirlo lento. `all` cuenta todo y `none`
solo nombra la fase.

Con `breath_sounds` se mezcla un soplo de aire debajo de la voz en cada
inhalación y exhalación — ruido rosa filtrado a la banda de una respiración,
subiendo o bajando según el sentido. Se mezcla después de medir, y la capa de
voz sola queda guardada aparte (`…-voz.mp3`) porque es la que se puede verificar:
sobre la mezcla, el fondo continuo borra los silencios que separan una señal de
la siguiente.

Una palabra suelta en minúscula sale mal ("siete" se oía como "site"), así que
a la síntesis se le manda con mayúscula y puntuación.

`lead_in_seconds` y `tail_seconds` son solo estimaciones de cuánto tarda la voz
en decir la entrada y el cierre: al grabar se miden de verdad y, si no caben, la
grilla se replanifica sola con los números reales (puede costar un ciclo). Lo
mismo con `gap_seconds`, que se encoge cuando el hueco aprieta — en una sesión
de cinco minutos es preferible perder la pausa que perder el ejercicio.

`npm run respiracion -- --verificar` mide cada archivo contra **su propia**
grilla guardada, no contra la definición de hoy; si el banco cambió desde que se
grabó, lo dice aparte.

La sesión le reserva a la respiración 120 s, y 150 s desde los quince minutos.
Dos minutos es el piso: con uno caben dos ciclos de 4-7-8 contando entrada y
cierre, y el ejercicio se acaba antes de que el cuerpo entre en ritmo. El
ejercicio mete los ciclos que le caben — con su propio tope, porque un suspiro
fisiológico no mejora estirándolo — y lo que no ocupa se lo lleva el tramo
personalizado, así que la meditación dura lo que la persona pidió. En el
reproductor se puede cambiar de ejercicio, saltarlo o apagarlo sin regenerar
nada: es una pista aparte, no un tramo del archivo.

### Curaduría del banco

El catálogo tiene que estar parejo en tres ejes: **área de la vida** (trabajo,
dinero, salud, relaciones, comunidad, práctica), **necesidad** (dormir,
ansiedad, foco, cuerpo, emoción, vínculo, sentido) y **forma** (duración,
idioma, ejercicio de respiración). Un banco con quince sesiones de trabajo y
ninguna de dinero está tan incompleto como uno con quince en cinco minutos y
ninguna en veinte.

```bash
npm run curaduria                        # el informe, sin gastar nada
npm run curaduria -- --investigar        # propone lo que falta, con evidencia
npm run curaduria -- --propuestas        # lo propuesto y sin aplicar
npm run curaduria -- --aplicar <slug>    # lo mete al banco
npm run curaduria -- --rechazar <slug>
npm run curaduria -- --markdown          # el informe tal cual, para pegarlo
```

El informe **se calcula leyendo la base**: no llama a ningún modelo y no cuesta
nada. La mitad de las decisiones de curaduría no necesitan que nadie opine — si
una intención declara que existe en diez y en veinte minutos y solo está
generada la de diez, eso es un hueco y punto. De ahí sale la lista ordenada que
consume `npm run generate -- --faltantes`.

`--investigar` sí gasta: le da el informe a Claude **con búsqueda web** y le
pide lo que el informe no puede deducir. Para las intenciones, situaciones
concretas del área que está floja. Para la respiración, protocolos con respaldo
publicado: cuántos segundos dura cada fase, en qué población se midió y qué se
observó, con la URL de cada fuente. Un ejercicio entra al banco con esa
referencia guardada o no entra.

La respiración no se mide por nombres sino por **la forma de la curva**, que es
lo que define el efecto: lo que baja la activación es que la exhalación sea más
larga que la inhalación, no que el ejercicio se llame 4-7-8. El informe reporta
cinco familias —exhalación larga, con retención, resonante (5–6 respiraciones
por minuto), doble inhalación y simétrica— y dice cuáles no cubre nadie. Un
banco con cuatro ejercicios que son la misma forma está tan desequilibrado como
uno con dos.

**Nada se aplica solo.** Una intención nueva cambia la portada y un ejercicio
nuevo lo va a hacer gente con el cuerpo, así que entre el modelo y el banco hay
una persona: las propuestas quedan en `omtana_content_proposals` con su
evidencia y esperan un `--aplicar`. Aplicar un ejercicio tampoco lo hace sonar:
hay que grabarlo con `npm run respiracion`, y el aviso lo recuerda.

### Renderizar video

```bash
npm run video -- <id-de-meditación>              # los tres formatos
npm run video -- <id> --formato vertical         # solo el de redes
npm run video -- <id> --pieza meditacion         # el recorte sale de la meditación
npm run video -- <id> --sin-cartas               # el largo, sin presentación ni cierre
npm run video -- <id> --muestra 25               # borrador rápido, no sube nada
npm run video -- --semanal 3                     # la tanda de la semana
npm run video -- --catalogo                      # todo lo público sin video
```

Tres formatos desde el mismo audio:

| Formato | Tamaño | Qué lleva | Para |
|---|---|---|---|
| `youtube` | 1920×1080 | presentación, la sesión entera y cierre de marca | el canal |
| `vertical` | 1080×1920 | una sola cosa, 20–45 s | Shorts, Reels, TikTok |
| `cuadrado` | 1080×1080 | una sola cosa, 20–45 s | el feed |

**Una pieza de redes lleva una sola cosa**: o el ejercicio de respiración o un
pasaje de la meditación. Las dos juntas en un minuto no alcanzan a ser ninguna
de las dos — la respiración queda a medio ciclo y la meditación entra por la
mitad de una frase. Para eso está el 16:9.

Y se corta donde el material tiene junta, no en el segundo redondo. La
respiración empieza en el primer "inhala" —la entrada explica el patrón y en
una pieza de veinte segundos es puro preámbulo— y termina justo donde empezaría
el ciclo siguiente, así que se puede repetir en bucle sin que se note. El
pasaje de meditación se elige entre las frases ya sincronizadas: empieza y
acaba en frase, y entre dos del mismo largo gana el que tiene más texto —
treinta segundos de silencio son perfectos dentro de una sesión y son un video
vacío en un teléfono.

Sin decir nada se recorta la respiración cuando la sesión la tiene;
`--pieza meditacion` fuerza lo otro.

**El largo abre y cierra con una carta.** Quien llega a un video de quince
minutos decide en los primeros diez segundos si se queda, y lo que necesita
saber es qué va a pasar: de qué es la sesión, cuánto dura y si abre con
respiración guiada o entra directo al cuerpo. Eso es la presentación. El cierre
es la única parte donde Omtana habla de sí misma: el wordmark grande,
`omtana.com` y la invitación a generar la suya. Las dos van sobre el mismo
fondo —el degradado sigue moviéndose y la música sigue sonando, así que el
video no arranca en seco ni termina en corte— y suman veintiún segundos al
archivo. `--sin-cartas` las apaga. Las piezas de redes no las llevan: en
veintitrés segundos, once de presentación serían casi todo el video.

**La escena es la del reproductor.** Fondo cálido que se mueve despacio, el
disco respirando con el ejercicio — la misma curva, literalmente: `discLevel`
vive en `src/lib/breathing.ts` y la usan la pantalla y el render, así que no
pueden separarse—, la onda de barras siguiendo la voz, el guion abajo como
subtítulo y el wordmark arriba. `--tema claro` usa la paleta de la app; el
default es la oscura, que es la que `globals.css` rotula "frames de video".

**Los subtítulos se miden, no se reparten.** El guion está guardado por tramos:
sabemos qué dice cada uno y en qué segundo empieza, pero no en qué segundo cae
cada frase. Repartir el texto de forma pareja sobre el tramo desincroniza a los
dos minutos, porque una meditación es mitad silencio. Así que `silencedetect`
dice dónde hay voz y las frases se reparten sobre el **tiempo hablado**: una
frase que cae antes de una pausa larga se queda en pantalla durante la pausa,
que es justo lo que uno quiere leer mientras respira. No cuesta modelo y
funciona sobre las meditaciones que ya existen.

La respiración va adentro del video de YouTube, con su audio y sus
instrucciones subtituladas, y es de donde salen los recortes de redes: es la
parte que se explica sola. La música sí se hornea acá — un video no tiene mezclador —, a
un volumen más bajo que el que trae el reproductor, porque una música que tapa
la voz no se arregla sin volver a renderizar.

Queda en `out/video/` el `.mp4`, el `.srt` y un `.json` con el título, la
descripción, los capítulos y las etiquetas con las que se sube. En el bucket
queda una copia, salvo que el archivo pase el techo de subida del proyecto — ahí
sirve el local, que es el que se sube igual.

Opciones: `--formato youtube,vertical,cuadrado|todos`, `--pieza
respiracion|meditacion|auto`, `--tema oscuro|claro`, `--musica <slug>|ninguna`,
`--sin-respiracion`, `--sin-cartas`, `--muestra <segundos>`, `--salida <dir>`,
`--sin-subir`, `--semanal <n>`, `--catalogo`.

### Subir a YouTube

```bash
npm run youtube -- --seco                 # dice qué subiría
npm run youtube -- --cuantos 3
npm run youtube -- --formato vertical --visibilidad unlisted
```

Sube **privado** salvo que se le diga otra cosa: el canal es la cara pública del
proyecto y una pieza generada de punta a punta merece que alguien la mire antes
que nadie más. Necesita `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` y
`YOUTUBE_REFRESH_TOKEN` — una app OAuth de Google Cloud con la YouTube Data API
v3 habilitada y un refresh token sacado una vez, con scope `youtube.upload`,
desde la cuenta dueña del canal. Sin esos secretos los videos se generan igual y
se suben a mano desde `out/video/`.

## Automatización

Tres workflows en `.github/workflows/`, y los tres llaman a lo mismo que se
puede correr a mano. Esa es la regla: **Actions no ejecuta nada que no ejecutes
tú**, así que si allá falla y acá no, la diferencia está en los secretos o en el
runner, no en lo que corre.

| Workflow | Cuándo | Qué hace | En local |
|---|---|---|---|
| `meditaciones.yml` | martes y viernes | genera las sesiones que más falta hacen | `npm run ci -- meditaciones --cuantas 3` |
| `videos.yml` | lunes | renderiza los tres formatos de la tanda semanal | `npm run ci -- videos --cuantos 3` |
| `curaduria.yml` | domingos | investiga qué falta y abre un issue con las propuestas | `npm run curaduria -- --investigar` |

```bash
npm run ci -- meditaciones --seco    # imprime los comandos, no ejecuta ninguno
npm run ci -- videos --seco
npm run ci -- videos --cuantos 1     # la tanda de verdad, más corta
```

`--seco` imprime cada paso con el comando exacto que correría, así que copiar el
que falló y repetirlo a mano es un copiar y pegar. Con
[`act`](https://github.com/nektos/act) se puede correr el workflow entero:

```bash
act workflow_dispatch -W .github/workflows/videos.yml \
  --secret-file .env.local --input cuantos=1 --input seco=true
```

Los tres tienen `workflow_dispatch`, así que se pueden disparar a mano desde la
pestaña Actions con sus parámetros. Ninguno publica nada por su cuenta: subir a
YouTube es una casilla que hay que marcar, y sube en privado.

**Secretos que hay que cargar en el repo** (Settings → Secrets → Actions):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
`ELEVENLABS_API_KEY` y, solo si se va a publicar, `YOUTUBE_CLIENT_ID`,
`YOUTUBE_CLIENT_SECRET` y `YOUTUBE_REFRESH_TOKEN`. Como variable (no secreto),
`NEXT_PUBLIC_SITE_URL`, que es el enlace que va en la descripción de cada video.

Las tandas llevan `concurrency` por nombre: dos corridas a la vez generarían la
misma sesión dos veces, porque las dos verían el mismo hueco.

## Estructura

```
src/
  app/                    una ruta por pantalla del diseño
    page.tsx              landing          acceso/     entrar y crear cuenta
    home/                 banco            personalizar/ ajustes de la sesión
    reproductor/[id]/     player           voces/      banco de voces
    biblioteca/           lo tuyo          catalogo/   público, sin cuenta
    planes/               créditos         perfil/     preferencias y datos
    terminos/             legal            api/        rutas de servidor
  lib/
    supabase.ts           cliente único con service role
    auth.ts               sesiones propias, scrypt, cupo mensual
    session-plan.ts       el reparto plantilla/tramos — lo usan app y scripts
    generation/
      template.ts         escribe y cachea los bloques fijos
      script.ts           escribe el tramo personalizado
      tts.ts              ElevenLabs
      audio.ts            mezcla con ffmpeg
      pipeline.ts         orquesta y persiste
    video/
      brand.ts            paleta, formatos y encuadre de cada pieza
      disc.ts             los cuadros del disco que respira, y la rejilla de la onda
      subtitles.ts        sincroniza el guion con el audio medido
      render.ts           arma el filtro de ffmpeg
      copy.ts             título, descripción y capítulos de cada video
    curation/
      balance.ts          qué le falta al banco, leyendo la base
      research.ts         qué proponer, con Claude y búsqueda web
      report.ts           el informe en Markdown
    manifest.ts           manifiesto de la PWA
    sw.js/                service worker, versionado por build
    offline/              lo que se ve sin red
  lib/version.ts          versión y hash del build
scripts/                  CLI: setup, seed, generación, video, curaduría
.github/workflows/        las tandas automáticas
supabase/migrations/      esquema
design/                   el archivo original de Claude Design, como referencia
```

## Decisiones que conviene conocer

**Sin RLS ni Supabase Auth.** Nada consulta la base desde el navegador: la
service role key vive solo en el servidor y la autorización se decide en
`src/lib/auth.ts` y en cada ruta. La migración además revoca los permisos de
`anon` y `authenticated`, así que la base no queda legible por PostgREST si esa
llave se filtrara.

**El audio no se descarga.** El bucket es privado y el reproductor recibe URLs
firmadas de tres horas.

**Se cobra al encolar, se devuelve si falla.** Al generar se descuenta el cupo
del mes o un crédito; si la generación falla, el primer `/status` que vea el
error devuelve el crédito y lo deja anotado en el libro de movimientos.

**El cupo mensual no necesita cron.** Se reinicia solo la primera vez que el
usuario aparece dentro de un mes nuevo.

## PWA y versión del build

Se instala en el teléfono y en el escritorio: manifiesto en `src/app/manifest.ts`,
íconos en `public/icons/` y service worker en `src/app/sw.js/route.ts`.

**El cache va versionado por build.** `next.config.ts` calcula un identificador
al compilar —`COMMIT_REF` en Netlify, `git rev-parse` en local— y lo inyecta como
`NEXT_PUBLIC_BUILD_ID`. Ese identificador nombra el cache del worker, así que al
activarse un deploy nuevo el worker borra todo lo que quedó del anterior. Nadie
arrastra assets viejos entre deploys.

**El HTML nunca se cachea.** Solo van a cache los archivos con hash en el nombre
(`/_next/static/`) y los activos de marca, que no cambian sin cambiar de URL. Las
páginas se piden siempre a la red: cachearlas sería justo lo que impide ver el
último deploy, y además traen datos de la sesión. Sin red, una navegación cae en
`/offline`. Las rutas `/api/`, las peticiones RSC y los rangos del `<audio>` pasan
de largo.

**La pestaña abierta se actualiza sola.** `ServiceWorkerBridge` pregunta por
versiones nuevas al volver a la pestaña y cada quince minutos, y cuando encuentra
una le cede el control y recarga. Si hay audio sonando espera: recargar a alguien
a mitad de una meditación sería peor que mostrarle un build de hace cinco
minutos. En desarrollo no registra nada y desregistra lo que hubiera, porque el
cache de `/_next/static/` es incompatible con la recarga en caliente.

El pie del sitio muestra `v0.1.0 · <hash>`, que es la forma de saber, mirando la
página, si lo que corre en el navegador es el último deploy.

## Despliegue

El sitio está en Netlify con `@netlify/plugin-nextjs`. Las páginas, la sesión, el
catálogo y el reproductor funcionan ahí sin más.

**La generación en vivo no corre en Netlify.** La mezcla usa `ffmpeg` y las
funciones de Netlify (Lambda) no traen binarios. El pipeline lo comprueba antes
de gastar en modelo y en síntesis, así que falla de inmediato y con mensaje claro
en vez de a mitad de camino. Tres salidas, de menor a mayor esfuerzo:

1. **Generar desde tu máquina** con `npm run generate`, que es como se arma el
   catálogo y el canal de YouTube igual. La app en producción queda de lectura.
2. **Incluir un ffmpeg estático** (`ffmpeg-static`, ~80 MB) en el bundle de la
   función y apuntar `FFMPEG_PATH` al binario que instala.
3. **Mover la generación a un worker** con ffmpeg disponible, y que la app solo
   encole. Es lo que conviene si llega tráfico real: hoy la generación corre
   dentro de la petición vía `after()`, que en serverless puede cortarse.

`netlify.toml` solo declara que `ELEVENLABS_MODEL_ID` no es un secreto — es el id
público del modelo. El escaneo sigue activo para todas las demás claves.

## Lo que queda por definir

Estos números están en `src/lib/config.ts`, en un solo lugar, con los valores del
documento v1: cupo del plan Free (3 al mes), precio de Pro ($59), precio del
crédito ($3) y los packs. Cambiarlos ahí los cambia en toda la app.
