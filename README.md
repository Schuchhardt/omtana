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

`ffmpeg` viene con `npm install` (`ffmpeg-static`); si tienes uno en el PATH
(`brew install ffmpeg`) se usa ese, que es con el que se afinaron los videos.
`ffprobe` ya no hace falta. Necesitas **Node 22 o más** (`nvm use` lee el
`.nvmrc`): con Node 20 la librería de Supabase falla al arrancar por falta de
WebSocket nativo.

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
| `npm run semanal` | La semana entera desde tu máquina: elige la sesión larga que más falta, la genera, renderiza 16:9 y 9:16 y, con `--publicar`, la programa en redes. Ver abajo. |
| `npm run zernio` | Programa en YouTube y redes, por la API de Zernio, los videos ya renderizados. Ver abajo. |
| `npm run ci` | Las tandas automáticas (`meditaciones`, `videos`) como una sola orden. Es lo que corre GitHub Actions. |
| `npm test` | Los tests: la mezcla con el ffmpeg empaquetado, las funciones de Netlify empaquetadas como en el deploy, los avisos y el ciclo de los jobs. Ver "Tests". |
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

**El tramo personalizado nombra lo que la persona pidió y contó, con sus
palabras**, desde las primeras frases y a lo largo de todo el tramo; la escena lo
acompaña, no lo reemplaza. Antes de escribir, el modelo declara sus *anclas*
(los elementos concretos de lo que la persona escribió) y
`src/lib/generation/grounding.ts` comprueba, sin modelo, que estén dichas y que
alguna suene al comienzo. Si no, se reescribe una vez diciéndole qué faltó; si
sigue sin hacerlo, la sesión sale igual y llega un aviso. El tramo además recibe
el texto de los bloques de la plantilla que suenan antes y después, para seguir
en el mismo lugar. Los bloques fijos nombran la intención en la entrada y en el
refuerzo (plantillas versión 5: las de la 4 no lo hacían y no se reutilizan).

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

**El largo abre con una presentación hablada y cierra con una carta.** Quien
llega a un video de quince minutos decide en los primeros diez segundos si se
queda, y lo que necesita saber es qué va a pasar. La misma voz de la sesión lo
dice — "esta sesión abre con dos minutos y medio de respiración guiada Caja
4-4-4-4; después viene una meditación de dieciocho minutos para…" — y la carta
lo muestra escrito en ese orden: primero el ejercicio, después la meditación.
La frase se sintetiza una vez por sesión y queda en el bucket
(`videos/<id>/intro-<hash>.mp3`), así que re-renderizar no la paga de nuevo;
sin `ELEVENLABS_API_KEY` la carta sale muda y de ocho segundos. El cierre es la
única parte donde Omtana habla de sí misma: el wordmark grande, `omtana.com` y
la invitación a generar la suya. Las dos van sobre el mismo fondo —el degradado
sigue moviéndose y la música sigue sonando— y `--sin-cartas` las apaga.

**Las piezas de redes son de dos clases.** El corte de respiración va en
**bucle**: empieza en un "inhala", termina donde arrancaría el ciclo siguiente,
sin fundidos ni cierre, con `omtana.com` fijo bajo el título, para que Instagram
y TikTok lo repitan sin que se note la juntura. El pasaje de meditación no se
puede repetir, así que cierra con dos segundos y medio de wordmark y
`omtana.com` sobre silencio, como el video del landing. Ninguna funde desde
negro: el primer cuadro es la miniatura.

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

### La semana desde tu máquina

```bash
npm run semanal -- --seco                 # qué elegiría y qué comandos correría, sin gastar
npm run semanal                           # genera la larga y renderiza 16:9 + 9:16 en out/video/
npm run semanal -- --publicar             # además programa la publicación por Zernio
npm run semanal -- --voz aurora --duracion 20
npm run semanal -- --solo-render <id>     # salta la generación: renderiza (y publica) esa
npm run semanal -- --cortos-extra 1       # suma el corto de una sesión vieja sin video
```

Una corrida por semana, a mano o con `launchd`/`cron` los lunes. El script solo
**elige** — intención, duración, voz, ejercicio y música — y crea la fila; lo
demás lo hacen `generate`, `video` y `zernio`, y cada comando se imprime antes
de correrlo, igual que en `ci.ts`.

La elección sale del informe de curaduría: `weeklyLongJob` toma el primer hueco
de **15 o 20 minutos** del área más floja del banco (a igual peso, 20 antes que
15). La voz rota entre las que tienen grabada la respiración para ese hueco e
idioma, salvo que se fije una "voz de la casa" con `--voz` o con
`OMTANA_WEEKLY_VOICE`, que reutiliza plantillas y cuesta un tercio en síntesis.
El ejercicio es el menos usado hasta ahora con esa voz. La música del video
rota con el número de semana; en la sesión no se guarda, porque el reproductor
la pone en vivo.

El 16:9 de una sesión larga supera el techo de subida del bucket (50 MB en el
plan Free), así que queda solo en `out/video/`. `npm run zernio` lo publica
desde ahí: no hace falta que esté en el bucket.

### Publicar en redes (Zernio)

```bash
npm run zernio -- --cuentas                        # qué cuentas hay conectadas
npm run zernio -- --seco                           # qué publicaría, sin tocar nada
npm run zernio -- <id-de-meditación>               # programa los exports de esa sesión
npm run zernio -- --cuantos 3 --plataformas youtube,instagram
npm run zernio -- --sincronizar                    # trae estados y URLs de lo programado
npm run zernio -- --cancelar <id-de-publicación>   # frena un post que todavía no salió
```

Opciones: `--formato vertical|youtube|cuadrado`, `--plataformas` (o
`PUBLISH_PLATFORMS`, por defecto `youtube,instagram`), `--en 48` (horas desde
ahora), `--programar 2026-10-01T10:00` (hora local en `PUBLISH_TIMEZONE`),
`--ahora`, `--visibilidad public|private|unlisted` (YouTube), `--desde out/video`.

**Sube público, pero programado 48 horas después.** Esa es la ventana de
revisión: el post queda en Zernio con hora, `--seco` y `--sincronizar` muestran
qué va a salir y `--cancelar` lo frena. Se elige público y no privado porque
Zernio no puede pasar un video de YouTube de privado a público después.
Cada formato va a las redes que le corresponden — el 16:9 a YouTube; el 9:16 a
YouTube Shorts, Instagram Reels y, si hay cuenta, TikTok, Facebook Reels y
Threads; el 1:1 a Instagram y Threads — con el copy adaptado a cada una (Threads
corta a 500 caracteres, `#Shorts` solo en YouTube, y los recortes enlazan al
largo cuando ya está publicado). Cada publicación queda en
`omtana_publications` (migración `0007`), que además impide programar dos veces
el mismo export en la misma red.

Necesita `ZERNIO_API_KEY` (zernio.com; dos cuentas conectadas son gratis, desde
la tercera USD 6 al mes cada una). Si el workspace de Zernio tiene cuentas de
varias marcas, hay que nombrar las de Omtana en `PUBLISH_ACCOUNTS` (usuario o
id, separadas por coma) o con `--cuentas-usar`: con más de una cuenta en una
red y sin esa lista, el script se niega a publicar, porque el video saldría en
todas. Para publicar en YouTube videos de más de 15
minutos el canal tiene que estar verificado por teléfono. Instagram exige una
cuenta Business o Creator ligada a una página de Facebook. Sin la key, los
videos se generan igual y se suben a mano desde `out/video/`.

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

## MCP: asistentes

Dos servidores [MCP](https://modelcontextprotocol.io) para que Claude (o cualquier
cliente MCP) use Omtana. Los dos son **Streamable HTTP sin estado** — JSON-RPC por
POST, sin sesiones ni SSE — porque corren en la función de Netlify, que nace y
muere en cada petición. El protocolo está escrito a mano en
`src/lib/mcp/protocol.ts` (unas 300 líneas, con zod para validar y para el JSON
Schema de cada herramienta) y probado contra el cliente oficial del SDK.

| Servidor | URL | Credencial |
|---|---|---|
| Personas | `/api/mcp` | `Authorization: Bearer omt_…`, una llave por persona, creada en **/perfil → Asistentes (MCP)** |
| Admin | `/api/mcp/admin` | `Authorization: Bearer $OMTANA_ADMIN_MCP_TOKEN` |

Necesita la migración `0008` (`npm run db:push -- --solo 0008`): llaves, uso y
costos, bitácora y las columnas de guion propio.

### El de las personas

Hace lo que hace la web, con la misma cuenta y el mismo cobro (cupo Free del
mes o un crédito; si falla, se devuelve). Toda creación devuelve el
`player_url`.

| Herramienta | Qué hace |
|---|---|
| `get_account` | Plan, cupo, créditos, valores por defecto |
| `list_options` | Voces, intenciones, respiración (con qué voces está grabada) y música |
| `create_meditation` | **Con parámetros**: intención, contexto, duración, voz, respiración, música, idioma |
| `create_meditation_from_script` | **Con guion propio**. `completo`: la sesión entera es el texto; `tramo`: el texto reemplaza el tramo personalizado de una plantilla. `[pausa 10]` deja diez segundos de silencio |
| `generate_from_prompt` | **Desde un pedido libre**: Claude elige los parámetros del catálogo y la crea. `dry_run` muestra la propuesta sin cobrar |
| `get_meditation` | Estado, `player_url` y `audio_url` (MP3 firmado, 3 h). `wait_seconds` espera hasta 45 s |
| `list_my_meditations`, `set_visibility` | Lo suyo |

**Música**: `music` la hornea en el MP3 (sirve para descargar el audio y
llevárselo). Sin `music`, el audio va seco y el reproductor ofrece el banco en
vivo, como siempre.

Límites por persona: tres sesiones generándose a la vez y treinta pedidos
libres por hora. El texto de los argumentos nunca se guarda en la bitácora:
solo el nombre de la herramienta, cuánto tardó y los nombres de los campos.

### El de administración

Todo lo anterior para cualquier cuenta o para el catálogo (`for_user`; no cobra
salvo `charge: true`), más la vista de la plataforma:

| Herramienta | Qué hace |
|---|---|
| `get_overview` | Personas, sesiones por estado y canal (web/mcp/admin), tasa de falla, colgados, escuchas, créditos, costos |
| `get_architecture` | Flujo, componentes, modelos por paso, precios, variables (solo si están), límites, filas por tabla |
| `check_generation_health` | La mezcla de prueba, en la función que genera |
| `get_costs` | **Traza de tokens y costos** por día, modelo, operación, canal o persona; costo medio por sesión y por duración; plantillas; las más caras |
| `get_meditation_trace` | Una sesión paso a paso: cuánto tardó cada paso y cada llamada al modelo y a la voz con sus tokens, caracteres y costo |
| `list_errors`, `list_logs`, `list_jobs` | Fallas agrupadas por patrón, colgados, bitácora con filtros |
| `retry_generation`, `reap_stale_jobs` | Reintentar una fallida, barrer colgados |
| `search_users`, `get_user`, `list_meditations`, `get_meditation`, `revoke_api_key`, `get_curation_report` | Personas, sesiones, llaves, curaduría |

### Conectarlo

```bash
# Claude Code
claude mcp add --transport http omtana https://omtana.com/api/mcp \
  --header "Authorization: Bearer omt_…"
claude mcp add --transport http omtana-admin https://omtana.com/api/mcp/admin \
  --header "Authorization: Bearer $OMTANA_ADMIN_MCP_TOKEN"
```

Con la API de Mensajes, el conector MCP recibe la llave en `authorization_token`.
Los clientes que solo hablan stdio pueden usar `npx mcp-remote <url> --header
"Authorization: Bearer …"`. Los conectores personalizados de claude.ai piden
OAuth, que estos servidores todavía no implementan: es el siguiente paso si se
quiere ofrecer "Conectar con Claude" sin copiar una llave.

### Costos y trazas

Cada llamada a un proveedor deja una fila en `omtana_usage_events`: tokens de
entrada, salida, razonamiento y caché que informó Anthropic, o caracteres de
ElevenLabs, y el costo estimado en USD, colgada de la meditación, el job, la
plantilla y la persona (`src/lib/telemetry.ts`, con `AsyncLocalStorage`: el
motor no pasa ids de mano en mano). Cada paso de la generación, cada aviso al
equipo y cada llamada MCP quedan en `omtana_logs` con su hora, que es de donde
sale la línea de tiempo de `get_meditation_trace`.

El costo es una **estimación** con la lista de precios pública
(`src/lib/pricing.ts`, con fecha): no conoce descuentos ni el plan de
ElevenLabs, que se fija con `ELEVENLABS_USD_PER_1K_CHARS`. Por eso se guarda
también lo medido: si un precio cambia, se recalcula sobre los tokens. Un
modelo que no está en la tabla queda con costo nulo, no en cero. Las llamadas
del CLI (respiración, muestras de voz, presentación de video, curaduría) también
quedan registradas, con su operación.

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
    supabase.ts           cliente único con service role (marcado server-only)
    supabase-client.ts    el mismo cliente sin la marca, para netlify/functions
    alerts.ts             avisos al equipo: webhook (Slack/Discord), correo y bitácora
    auth.ts               sesiones propias, scrypt, cupo mensual
    telemetry.ts          trazas: uso y costo por llamada, bitácora (AsyncLocalStorage)
    pricing.ts            precios por modelo y por caracter, con fecha
    mcp/
      protocol.ts         MCP Streamable HTTP sin estado (JSON-RPC por POST)
      user-server.ts      herramientas de /api/mcp
      admin-server.ts     herramientas de /api/mcp/admin
      api-keys.ts         llaves omt_ por persona (solo el hash en la base)
    meditations/
      create.ts           crear, cobrar y encargar: lo comparten la web y los MCP
      actions.ts          con parámetros, con guion propio, desde un pedido libre
      interpret.ts        pedido libre → parámetros del catálogo, con Claude
      refund.ts           devolver lo cobrado por una generación fallida
    admin/reports.ts      resumen, costos, trazas, errores, arquitectura
    session-plan.ts       el reparto plantilla/tramos — lo usan app y scripts
    generation/
      template.ts         escribe y cachea los bloques fijos
      script.ts           escribe el tramo personalizado
      tts.ts              ElevenLabs
      audio.ts            mezcla con ffmpeg (y dónde encontrarlo)
      pipeline.ts         orquesta y persiste
      custom-script.ts    guiones propios: bloques y "[pausa N]"
      dispatch.ts         en qué función corre y el encargo firmado
      jobs.ts             tomar un job, registrar fallas, barrer colgados
      health.ts           ¿este entorno puede generar? mezcla de prueba
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
netlify/functions/        generación en segundo plano, salud y barrido
tests/                    npm test
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
del mes o un crédito; si la generación falla, el primer `/status` (o
`get_meditation` del MCP) que vea el error devuelve lo cobrado y lo deja
anotado en el libro de movimientos. Solo se devuelve lo que de verdad se cobró:
una sesión de Pro fallida no suma un crédito.

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
catálogo y el reproductor corren en la función de Next.

**La generación corre en otra función.** La de Next no sirve para eso por dos
razones: en Lambda no hay `ffmpeg`, y una función síncrona de Netlify se corta a
los 60 segundos contando lo que corre en `after()` — escribir el guion con el
modelo y sintetizar la voz suele pasarse de eso, y la primera sesión de una
intención (la que paga la plantilla) se pasa siempre. Así que:

```
POST /api/meditations ──crea sesión y job──▶ /.netlify/functions/generate-background
        │ responde de inmediato                 en segundo plano, hasta 15 min,
        ▼                                       con ffmpeg-static empaquetado
reproductor ──consulta──▶ /api/meditations/[id]/status
```

| Función (`netlify/functions/`) | Qué hace |
|---|---|
| `generate-background` | Genera la sesión. Recibe el encargo firmado (HMAC con la service role key), toma el job solo si sigue en cola —Netlify reintenta las invocaciones que fallan, y un reintento no puede volver a pagar modelo ni voz— y, si falla, lo registra y avisa. |
| `generation-health` | `GET /.netlify/functions/generation-health` dice si este deploy puede generar: busca ffmpeg, **mezcla una sesión de prueba de verdad** y revisa las variables. 200 o 503. Corre sola después de cada deploy y avisa si algo falla. |
| `reap-generations` | Cada 15 minutos da por fallidas las generaciones colgadas (la función se cortó, el encargo se perdió) y avisa. `/status` hace lo mismo con la sesión que alguien está esperando. |

`netlify.toml` es lo que hace que ffmpeg llegue: deja `ffmpeg-static` fuera del
bundle (para que su `__dirname` apunte al binario real) y lo suma con
`included_files`. `next.config.ts` lo excluye de la función de Next, que no lo
necesita. Al compilar en Netlify, `next.config.ts` fija que la app despache a la
función en segundo plano; en local, `npm run dev` sigue generando en el mismo
proceso. `GENERATION_RUNNER=inline|background` manda sobre las dos cosas.

**Después de desplegar**, abre `/.netlify/functions/generation-health`: tiene que
decir `"ok": true` y mostrar la ruta del ffmpeg de `node_modules/ffmpeg-static`.

### Avisos

Cada generación que falla, cada una que se queda colgada y cada deploy que no
puede generar mandan un aviso con el error completo, la sesión, el paso en que se
cortó y el deploy:

- `ALERT_WEBHOOK_URL`: webhook entrante de Slack, Discord o Google Chat.
- `RESEND_API_KEY` + `ALERT_EMAIL_TO` (+ `ALERT_EMAIL_FROM`): correo por Resend.

Sin ninguno, el aviso queda en el log de la función con el prefijo
`[omtana:alerta]`. Las variables van en Netlify con alcance **Functions**.

La persona que generó no ve el error técnico: ve "No pudimos terminar tu sesión
por un problema de nuestro lado…" y recupera lo cobrado. La excepción es cuando
el modelo se niega a escribir con su contexto, que es lo único que ella puede
arreglar.

### Tests

```bash
npm test
```

Corren con el runner de Node (`node:test` vía `tsx`), sin dependencias extra, y
en GitHub Actions en cada push y PR (`.github/workflows/tests.yml`, junto con
tipos y lint). Lo que cuidan:

- **La mezcla, con el ffmpeg de producción.** Arman sesiones de verdad con el
  binario de `ffmpeg-static`, no con el del sistema: si una versión nueva pierde
  un filtro o el codificador de MP3, se ve acá.
- **Las funciones, empaquetadas como en Netlify.** esbuild, ESM, sin la condición
  `react-server`, `ffmpeg-static` externo; después las cargan **sin ffmpeg en el
  PATH y desde otra carpeta**, como en Lambda, y corren el chequeo de salud. Si
  algo del motor vuelve a importar `"server-only"` o ffmpeg deja de encontrarse,
  falla.
- **`netlify.toml`.** Que las funciones que mezclan lleven el binario y que la
  app despache a una función que existe.
- **Que la sesión hable de la persona.** El prompt del tramo pide nombrar lo
  suyo, recibe lo que suena alrededor, y un tramo que no lo nombra se reescribe
  (con un modelo de mentira: no gasta API).
- **Avisos, despacho y jobs.** Que un canal caído no tape a los otros, que la
  firma no se pueda falsificar, que un job corra una sola vez y que los colgados
  se den por fallidos sin pisar a los que terminaron.

Conviene que el comando de build de Netlify sea `npm test && npm run build`:
así un deploy que no puede generar ni siquiera se publica.

`netlify.toml` también declara que `ELEVENLABS_MODEL_ID` no es un secreto — es el
id público del modelo. El escaneo sigue activo para todas las demás claves.

## Lo que queda por definir

Estos números están en `src/lib/config.ts`, en un solo lugar, con los valores del
documento v1: cupo del plan Free (3 al mes), precio de Pro ($59), precio del
crédito ($3) y los packs. Cambiarlos ahí los cambia en toda la app.
