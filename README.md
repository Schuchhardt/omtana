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
| `npm run video` | Exporta el video 1920×1080 para YouTube. |
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

# El banco inicial completo, público en el catálogo
npm run generate -- --curated

# Reintentar lo que falló
npm run generate -- --retry
```

Opciones: `--intencion`, `--i <slug>`, `--contexto`, `--duracion 5|10|15|20`,
`--voz <slug>`, `--respiracion <slug>|ninguna`, `--sin-respiracion`,
`--idioma es|en|pt`, `--privada`, `--musica <slug>`.

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

### Exportar video

```bash
npm run video -- <id-de-meditación>
npm run video -- --catalogo          # todas las públicas que no tengan video
```

Fondo oscuro, onda de audio reactiva, palabras clave sincronizadas y el wordmark.
Queda en `out/video/` y también en el bucket. La primera corrida baja la
tipografía Jost y rasteriza el logo.

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
    manifest.ts           manifiesto de la PWA
    sw.js/                service worker, versionado por build
    offline/              lo que se ve sin red
  lib/version.ts          versión y hash del build
scripts/                  CLI: setup, seed, generación, video
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
