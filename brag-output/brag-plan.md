# Brag Plan: Omtana

## What is this app?
Omtana escribe una meditación guiada alrededor de la intención que escribe cada
persona — guion de Claude, voz de un banco de actores, ejercicio de respiración
y música — y la entrega en menos de un minuto, porque de una sesión de quince
minutos once ya están pregenerados y solo cuatro se escriben al vuelo.

## The angle
El catálogo al revés. Toda app de meditación te pide elegir la sesión que más se
acerca a lo que te pasa; Omtana te pide decir lo que te pasa. Y la parte más
inteligente no es el modelo: es la arquitectura **plantilla + tramos**, que se
puede *dibujar* — cinco filas, cuatro grises y una de color. Ese diagrama existe
literalmente en la portada del producto y es el centro del video.

El video no explica la idea: la muestra en el orden en que la vive alguien.
Escribes → se reparte la sesión → respiras. Nada de lenguaje de producto.

## Hook (first 2-3 seconds)
La promesa, en dos tiempos sobre la arena: primero
**"No busques entre las meditaciones que ya existen."** en tinta; después,
debajo, **"Crea la tuya."** en clay — la personalización dicha como lo que es,
la función del producto y no un matiz. El disco que respira ya está ahí, a la
derecha, muy tenue — la única cosa en movimiento antes de que llegue el texto.
El giro de la segunda línea es lo que compra los veinte segundos siguientes.

## Key moments (the middle)
- El campo de intención real — pastilla `rounded-full` en papel, punto clay de
  7px, botón tinta "Continuar" — con **"No logro dormir por el trabajo"**
  escribiéndose carácter por carácter, y las cuatro sugerencias reales debajo.
- La tarjeta **"Anatomía de una sesión de 15 minutos"** armándose fila por fila:
  cuatro puntos `clay-bar` y **un solo punto clay** en "Tu contexto". Cuando la
  última fila cae, el punto de color pulsa y aparece la línea de la portada:
  *"Solo el punto de color se escribe para ti."*
- El corte al tema oscuro del reproductor — el mismo `oscuro` que usa
  `src/lib/video/brand.ts` — con el disco respirando de verdad sobre la curva
  4-7-8: **Inhala · 4**, y la exhalación larga cayendo en el golpe fuerte.

## Outro / punchline
Lo que hace el propio renderizador de Omtana en su cierre: el wordmark grande
sobre el fondo oscuro, `Meditaciones generadas` debajo y `omtana.com`. Silencio.
La música se va antes de que se vaya el logo.

## User flow worth showing
Los tres tiempos reales, y son los tres centros del video:
1. **Entrada** — `/home`: escribes la intención en el campo (o tocas una sugerencia).
2. **Acción** — el reparto de la sesión: sobre la plantilla pregenerada se
   intercala tu tramo. Es lo que muestra el panel "Tu sesión" al personalizar y
   la tarjeta de anatomía en la portada.
3. **Resultado** — `/reproductor/[id]`: disco que respira con el ejercicio, onda
   sobre la voz, fase y conteo en pantalla.

## Tone
- Preset: `polished`
- Creative direction: película de producto en voz baja — la calma de la propia
  app, a escala de video.
- Interpretation: pocos planos y largos, entradas de 0.4–0.6s y después reposo,
  tipografía Jost 300–500 con tracking abierto, hairlines de la marca en vez de
  sombras, un solo acento clay. La contención no es una limitación estética:
  es la misma decisión que toma el producto (radios de 4px, líneas de 1px,
  fondo arena). Nada grita; el contenido es suficientemente raro.

## Format: landscape — 1920x1080
## Duration: 23.0s

## Language
El texto en pantalla va en español y **verbatim del producto**. Es un producto en
español (y la copia es la mejor que tiene); traducirla lo volvería genérico.

## Visual identity (from the project)
- Background: `#f6f1e9` (sand) · profundo `#f1eadf` · papel `#fffdf9`
- Accent: `#b4643c` (clay) · `#8e4a29` deep · `#c9a489` tint · `#ebd6c6` glow · `#f6e9dd` mist · `#d5c4b2` bar
- Text: `#241f1a` (ink) · `#4a4239` soft · `#6b6157` muted · `#9a8f81` faint
- Lines: `#e4daca` · `#ede4d6` hair · `#e0d5c3` field
- Dark block (tema `oscuro` del render de video): bg `#231c17` / `#151110`,
  glow `#463226`, disco `#c4a98f`, aro `#8e7561`, texto `#f6f1e9`,
  soft `#c4b9aa`, faint `#a79c8d`, barra `#b4643c`, riel `#38302a`
- Display font: Jost (500) — el mismo `next/font/google` de la app
- Body font: Jost (300/400)
- Strongest visual element: el disco que respira (`BreathCircle`) — halo radial
  clay escalando 0.82→1.12 en 12s — con la onda determinista de barras dentro.
- Assets reales a usar: `public/brand/omtana-wordmark-black.svg`,
  `omtana-wordmark-white.svg`, `omtana-symbol-black.svg`.

## Share copy (draft)
No busques entre las meditaciones que ya existen: en Omtana creas la tuya. Dices
qué necesitas hoy y el guion se escribe alrededor de eso. De quince minutos,
once ya existen y cuatro se escriben para ti — por eso está lista en menos de un
minuto.

## Audio direction
- Role: **sin música.** El audio es diegético: se oye lo que hace el producto y
  nada más. Una cama corporativa encima de una app de meditación sonaba a otra
  cosa, y el silencio es material de esta marca, no un hueco.
- Music: **none** — decisión explícita, no una limitación de assets.
- Capas, en orden de aparición:
  - Tecleo al escribir la intención (4.9–6.5 s): uno de cada cuatro caracteres.
  - Un click al presionar "Continuar" (7.2 s).
  - Un golpe muy suave cuando aterriza la tarjeta (8.7 s), apenas insinuado.
  - **La respiración (16.15–20.5 s):** ruido rosa filtrado a la banda de un
    aliento, que sube al inhalar y cae al soltar. Es lo mismo que hace
    `breath_sounds` en `src/lib/breathing.ts`, sintetizado para el video.
  - Una campana en el wordmark (19.62 s), que resuena sobre el silencio.
- Silencios por diseño: 0–4.9 s (el gancho se lee) y 9–15.5 s (la anatomía se
  lee). El primero es corto y el segundo llega cuando ya se oyó el tecleo, así
  que nadie va a pensar que el audio está roto.
- Audio-reactive treatment: **none** — sin música no hay energía que seguir. El
  halo y el resplandor respiran por su cuenta, en ciclos largos y contados.
- Music cue guidance: no aplica. Los tiempos de la edición se mantuvieron —
  eran buenos como ritmo — pero ya no derivan de ningún compás.
- Restraint rule: ningún whoosh, ningún riser, ningún sonido por fila de la
  tarjeta, y nada encima de la respiración salvo la respiración misma.

## Storyboard

### Scene 1 — Hook: la frase del hero — 4.0s (0.00 → 4.00)
Campo arena `#f6f1e9` con grano muy fino y un halo clay-mist arriba a la
izquierda. Anclado a la izquierda: eyebrow `MEDITACIONES GENERADAS` (tracking
0.2em, muted-soft), y debajo el hero en dos líneas. A la derecha, el disco que
respira: aro hairline `line-soft`, halo radial clay-glow→clay-mist, escalando
despacio; dentro, la onda de 44 barras clay en reposo bajo.
Texto: `No busques entre las meditaciones que ya existen.` entra en 0.45s
(y=28→0, opacidad, `power3.out`, 0.6s); a los 2.0s baja a muted y entra en clay
`Crea la tuya.` en 500.
Sequential/interaction: none (dos líneas escalonadas, no una lista).
Audio intent: silencio. El video empieza como empieza una sesión.
Audio-coupled idea: none.
Music: none.
Transition mood: soft (crossfade 0.6s) → Scene 2

### Scene 2 — La intención: el campo real — 4.74s (4.00 → 8.74)
Mismo fondo; el disco se va a la derecha y se apaga a 35%. Izquierda, arriba:
`01 — INTENCIÓN` en clay 12px/0.18em (el rótulo real del paso 01). Centro: la
pastilla real de `IntentionInput` — papel `#fffdf9`, borde `#e0d5c3`,
`border-radius: 999px`, punto clay de 7px, texto 17px→32px a escala de video,
botón tinta "Continuar" con radio completo. Debajo, la fila real de sugerencias:
`Sugerencias` en faint, y cuatro pastillas hairline:
`No logro dormir por el trabajo` · `Ansiedad a fin de mes` ·
`Antes de una conversación difícil` · `Cinco minutos y volver`.
Sequential/interaction: **sí** — la intención `No logro dormir por el trabajo`
se escribe carácter por carácter entre 4.9s y 6.6s (caret clay intermitente,
finito). En 7.2s el botón "Continuar" hace un dip de escala (1→0.96→1) y la
pastilla de sugerencia correspondiente se ilumina un instante. Sostener el
estado completo hasta 8.74s (~1.5s de lectura tras el tecleo).
Audio intent: presencia física, muy suave. Se oye que alguien está escribiendo,
no que hay efectos.
Audio-coupled idea: ticks de teclado de `keyboard/` en ~1 de cada 3 caracteres,
aleatorizados con semilla fija, a 0.30; un `interface/click_003.ogg` a 0.45 en
el dip del botón.
Music: none — solo el tecleo.
Transition mood: clean (wipe suave 0.45s desde el borde izquierdo) → Scene 3

### Scene 3 — La anatomía: plantilla + tramos — 6.55s (8.74 → 15.29)
El plano más importante. Fondo arena. A la izquierda, el bloque de arquitectura:
eyebrow `PLANTILLA + TRAMOS` en muted-soft, título
`Anatomía de una sesión de 15 minutos` (el rótulo real de la tarjeta, a escala de
video) y, bajo él, la tarjeta de papel real: `#fffdf9`, borde `line-soft` de 2px,
radio 4px, sin sombra — hairlines, como en la app.
A la derecha de la tarjeta, en foreground mono/faint:
`once ya existen · cuatro se escriben para ti`.
Filas de la tarjeta, verbatim de `session-plan.ts` / la tabla del README:
`Respiración guiada 2 min` · `Entrada al cuerpo 2 min` · `Tu contexto 4 min` ·
`Refuerzo e imágenes 5 min` · `Cierre 2 min`. Punto de 8px: `clay-bar #d5c4b2`
en las cuatro fijas, **clay `#b4643c`** en `Tu contexto`.
Sequential/interaction: **sí** — la tarjeta aterriza en 8.74 (lock fuerte) y las
cinco filas entran una por una en la grilla de beats 9.29 · 9.83 · 10.37 · 10.93
· 11.46 (x=-18→0 + opacidad, 0.35s, escalonadas). Son etiquetas cortas y el set
completo se sostiene después: a los 12.02s el punto clay de `Tu contexto` pulsa
(escala 1→1.35→1) y su fila sube a tinta llena; a los 12.55s entra la línea
`Solo el punto de color se escribe para ti.` en ink-soft debajo de la hairline
divisoria, y ahí se queda 2.74s.
Audio intent: el momento en que el video "hace clic". Un solo golpe cálido, y
después nada — que las filas caigan en silencio sobre la música.
Audio-coupled idea: `impact/impactSoft_medium_001.ogg` a 0.55 en 8.70s (justo
antes de que la tarjeta resuelva). Sin sonido por fila.
Music: none — un golpe apenas, y después se lee en silencio.
Transition mood: soft pero decidido — el disco crece desde la tarjeta y el fondo
vira a `#231c17` en 0.7s (la propia app hace este cambio de tema) → Scene 4

### Scene 4 — El reproductor: respirar — 4.37s (15.29 → 19.66)
Tema `oscuro` del render real: fondo `#231c17`→`#151110` en radial, halo
`#463226`. Centro-derecha: el disco `#c4a98f` con aro `#8e7561`, respirando sobre
la curva del 4-7-8 de verdad (expansión de 4s, retención, exhalación larga).
Bajo el disco, la onda de barras `#c4a98f`. Arriba a la izquierda, el wordmark
blanco al 50%. Abajo, barra de progreso clay `#b4643c` sobre riel `#38302a`.
Izquierda: rótulo `RESPIRACIÓN GUIADA · 4-7-8` en `#a79c8d`, y la fase grande en
`#f6f1e9`.
Sequential/interaction: **sí** — la fase cambia con el ejercicio: `Inhala · 4`
entra a 15.60s y sostiene hasta 18.56s; en **18.56s** (lock fuerte) cambia a
`Suelta · 8` mientras el disco hace la exhalación larga, y sostiene hasta 19.66s
(1.1s: dos palabras, por encima del piso de lectura).
Audio intent: la única escena donde el audio se abre, y lo hace con lo que
corresponde: el aliento. Nada más.
Audio-coupled idea: la respiración sintetizada, sincronizada con el disco.
Music: none.
Transition mood: soft — el disco se desvanece hacia el halo, el fondo se queda
→ Scene 5

### Scene 5 — Cierre — 3.34s (19.66 → 23.00)
Mismo fondo oscuro, ahora casi vacío: solo el halo `#463226` muy abierto. El
wordmark blanco grande aterriza en **19.66s** (lock fuerte) con un ascenso de
14px y opacidad, 0.55s, `power3.out`. A los 20.75s (beat) entra
`Meditaciones generadas` en `#c4b9aa`; a los 21.28s (beat), `omtana.com` en
`#a79c8d` con tracking abierto. Una hairline `#38302a` de 1px se abre bajo el
wordmark (scaleX 0→1) en 20.4s.
Sequential/interaction: sí — tres entradas escalonadas, cada una por encima del
piso de lectura (wordmark 3.3s, tagline 2.2s, url 1.7s).
Audio intent: una campana sobre el silencio, y la cola del aliento debajo.
Audio-coupled idea: `impact/impactBell_heavy_000.ogg` a 0.40 en 19.62s, dejándolo
resonar sobre la música que ya se va.
Music: none. Los últimos 2 s son silencio absoluto.
Transition mood: fin (el último frame es el logo asentado, no un fundido a negro)

**Music mood for this video:** none — pieza sin música, por decisión
**Audio summary:** sin música. Se oye escribir mientras se escribe, se lee en
silencio, se respira cuando el disco respira y suena una campana al final. Todo
lo que se oye es algo que el producto hace.

## Reading-time audit
| Texto | Entra | Asentado hasta | Hold | Piso | ✓ |
|---|---|---|---|---|---|
| `No busques entre las meditaciones que ya existen.` (8 pal.) | 0.45 | 4.00 | 3.55s | 2.4s | ✓ |
| `Crea la tuya.` (3 pal.) | 2.00 | 4.00 | 2.00s | 1.2s | ✓ |
| `01 — INTENCIÓN` | 4.20 | 8.74 | 4.54s | 0.8s | ✓ |
| `No logro dormir por el trabajo` (tecleada, 6 pal.) | 6.60 | 8.74 | 2.14s | 1.8s | ✓ |
| 4 pastillas de sugerencia | 4.55 | 8.74 | 4.19s | 0.8s | ✓ |
| `Anatomía de una sesión de 15 minutos` | 8.74 | 15.29 | 6.55s | 1.8s | ✓ |
| 5 filas (set completo en pantalla) | 11.46 | 15.29 | 3.83s | 0.8s c/u | ✓ |
| `Solo el punto de color se escribe para ti.` (8 pal.) | 12.55 | 15.29 | 2.74s | 2.4s | ✓ |
| `once ya existen · cuatro se escriben para ti` (8 pal.) | 9.00 | 15.29 | 6.29s | 2.4s | ✓ |
| `Inhala · 4` | 15.60 | 18.56 | 2.96s | 0.8s | ✓ |
| `Suelta · 8` | 18.56 | 19.66 | 1.10s | 0.8s | ✓ |
| Wordmark | 19.66 | 23.00 | 3.34s | — | ✓ |
| `Meditaciones generadas` (2 pal.) | 20.75 | 23.00 | 2.25s | 0.8s | ✓ |
| `omtana.com` | 21.28 | 23.00 | 1.72s | 0.8s | ✓ |

Suma de escenas: 4.00 + 4.74 + 6.55 + 4.37 + 3.34 = **23.00s**.
