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
npm run dev
```

La app arranca y se puede recorrer entera aunque Supabase todavía no esté
conectado: muestra un aviso arriba y estados vacíos con el comando que falta.

Necesitas `ffmpeg` y `ffprobe` en el PATH (`brew install ffmpeg`).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run db:push` | Aplica `supabase/migrations/`. `-- --print` escupe el SQL para pegarlo en el editor de Supabase. |
| `npm run seed` | Carga voces, intenciones y la música que encuentre en `assets/music/`. Idempotente. |
| `npm run voices:link` | Muestra el estado del enlace con ElevenLabs. `-- --auto` asigna por orden; `-- aurora=<voice_id>` asigna una. |
| `npm run samples` | Graba la muestra de 12 s de cada voz. `-- --all` las rehace todas. |
| `npm run generate` | Genera meditaciones. Ver abajo. |
| `npm run video` | Exporta el video 1920×1080 para YouTube. |

### Generar meditaciones

```bash
# Una, a partir de una intención del banco
npm run generate -- --i dormir-sin-dar-vueltas --duracion 10 --voz aurora

# Una, con intención y contexto libres
npm run generate -- \
  --intencion "Mejorar mi salud" \
  --contexto "Dieta sin gluten hace tres meses, me cuesta el fin de semana" \
  --duracion 15 --voz aurora --musica cuerdas-lentas

# El banco inicial completo, público en el catálogo
npm run generate -- --curated

# Reintentar lo que falló
npm run generate -- --retry
```

Opciones: `--intencion`, `--i <slug>`, `--contexto`, `--duracion 5|10|15|20`,
`--voz <slug>`, `--musica <slug>|ninguna`, `--idioma es|en|pt`, `--publica`.

La primera meditación de una intención paga la plantilla (bloques fijos escritos
y sintetizados una vez). Las siguientes con esa misma intención, duración, idioma
y voz reutilizan ese audio y solo generan el tramo personalizado.

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

## Lo que queda por definir

Estos números están en `src/lib/config.ts`, en un solo lugar, con los valores del
documento v1: cupo del plan Free (3 al mes), precio de Pro ($59), precio del
crédito ($3) y los packs. Cambiarlos ahí los cambia en toda la app.
