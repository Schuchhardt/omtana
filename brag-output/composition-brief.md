# Hyperframes Composition Brief: Omtana

## Objective
Create a short launch-style brag video for Omtana — a Spanish-language app that
writes a guided meditation around the intention a person types, then delivers it
in under a minute because most of the audio is pre-generated.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 23.0s (root `data-duration="23"`)

## Source Material
- Project root: the repository root
- Primary files read: `README.md`, `src/app/globals.css`, `src/app/page.tsx`,
  `src/app/layout.tsx`, `src/lib/i18n/es.ts`, `src/lib/session-plan.ts`,
  `src/lib/breathing.ts`, `src/lib/video/brand.ts`, `src/components/BreathCircle.tsx`,
  `src/components/Wave.tsx`, `src/components/IntentionInput.tsx`, `scripts/seed.ts`
- Product name: **Omtana**
- Tagline / strongest claim: `No busques entre las meditaciones que ya existen. Crea la tuya.`
- Key UI moments to recreate (in order of importance):
  1. The **session-anatomy card** from the landing page — paper card, five rows,
     four `clay-bar` dots and one clay dot on `Tu contexto`.
  2. The **intention field** from `IntentionInput.tsx` — pill-shaped paper input,
     7px clay dot, ink "Continuar" button, four real suggestion chips.
  3. The **player / breathing screen** in the app's own `oscuro` video theme —
     breathing disc, bar wave, phase label, clay progress bar, white wordmark.
- Copy that must appear verbatim (Spanish — do NOT translate):
  - `MEDITACIONES GENERADAS`
  - `No busques entre las meditaciones que ya existen.`
  - `Crea la tuya.`
  - `01 — INTENCIÓN`
  - `No logro dormir por el trabajo` (typed into the field)
  - `Ansiedad a fin de mes` / `Antes de una conversación difícil` / `Cinco minutos y volver` (chips)
  - `Sugerencias`
  - `Continuar`
  - `PLANTILLA + TRAMOS`
  - `Anatomía de una sesión de 15 minutos`
  - `Respiración guiada` 2 min · `Entrada al cuerpo` 2 min · `Tu contexto` 4 min ·
    `Refuerzo e imágenes` 5 min · `Cierre` 2 min
  - `once ya existen · cuatro se escriben para ti`
  - `Solo el punto de color se escribe para ti.`
  - `RESPIRACIÓN GUIADA · 4-7-8`
  - `Inhala · 4` → `Suelta · 8`
  - `Meditaciones generadas`
  - `omtana.com`

## Creative Direction
- Tone preset: **polished**
- Creative direction: película de producto en voz baja — the app's own calm at
  video scale.
- Interpretation: few, long shots. Entrances 0.4–0.6s then rest. One accent hue.
  Hairlines instead of shadows. The product's own restraint is the style; do not
  add energy it does not have.
- Angle: the catalog, inverted. Every meditation app asks you to pick the session
  closest to what you're feeling; Omtana asks you to say what you're feeling. And
  the cleverest part is drawable — five rows, four grey, one in colour.
- Hook: the promise in two beats — the catalog refused, then the feature named
  (`Crea la tuya.`) — with the breathing disc already alive at the right edge.
- Outro / punchline: what Omtana's own video renderer does at the end of every
  session — big wordmark on the dark field, `Meditaciones generadas`,
  `omtana.com`, silence.
- Avoid:
  - Generic SaaS language (none of it is needed — the product's copy is better)
  - Translating any on-screen copy to English
  - Abstract filler visuals, waveform/equalizer graphics, particles
  - Any visual redesign — this palette and these components are the brand
  - Dark-theme instincts: scenes 1–3 are a **light** canvas and must stay light

## Visual Identity
Taken verbatim from `src/app/globals.css` `@theme` and `src/lib/video/brand.ts`.

Light canvas (scenes 1–3):
- Background: `#f6f1e9` (sand) · deep `#f1eadf` · paper `#fffdf9`
- Text: `#241f1a` (ink) · `#4a4239` (ink-soft) · `#6b6157` (muted) ·
  `#8e8376` (muted-soft) · `#9a8f81` (faint) · `#b5aa9b` (faint-soft)
- Accent: `#b4643c` (clay) · `#8e4a29` (deep) · `#c9a489` (tint) ·
  `#ebd6c6` (glow) · `#f6e9dd` (mist) · `#d5c4b2` (bar)
- Lines: `#e4daca` (line) · `#e7decf` (soft) · `#e0d5c3` (field) · `#ede4d6` (hair)

Dark canvas (scenes 4–5) — the app's `oscuro` video theme:
- Background `#231c17` → `#151110` (radial, NOT a linear full-screen gradient)
- Glow `#463226` · disc `#c4a98f` · disc ring `#8e7561` · wave `#c4a98f`
- Text `#f6f1e9` · soft `#c4b9aa` · faint `#a79c8d` · bar `#b4643c` · track `#38302a`

Type:
- Display font: **Jost 500** · Body: **Jost 300/400** (the app's `next/font/google`)
- Ship Jost locally as woff2 in `assets/fonts/` with in-file `@font-face` —
  a named `font-family` without one trips `font_family_without_font_face`.
- Letter-spacing: headings `-0.02em` (the app's rule); eyebrows/labels `0.18–0.20em`
  uppercase.
- Video scale: headline 72–96px, body 32–40px, labels 20–24px, borders 2px,
  decorative opacity 12–25%.

Project assets to copy into the composition:
- `public/brand/omtana-wordmark-black.svg`
- `public/brand/omtana-wordmark-white.svg`
- `public/brand/omtana-symbol-black.svg`

Visual references from the project:
- `BreathCircle.tsx` — circle, hairline `line-soft` ring, radial
  `clay-glow 0% → clay-mist 55% → transparent 72%`, `omBreathe` keyframes
  (scale 0.82 ↔ 1.12, opacity 0.55 ↔ 0.9 over 12s).
- `Wave.tsx` — `barHeights(count, max)`: deterministic sine sum
  `sin(i*0.37)*0.5 + sin(i*0.11)*0.35 + sin(i*1.7)*0.15`, clamped at 0.12.
  Reuse this exact function; it is the product's wave, and it is already
  deterministic (no `Math.random` needed).
- `IntentionInput.tsx` — the pill field and suggestion chips.
- `globals.css` `.om-card` / `.om-field` / `.om-btn-solid` / `.om-pill` / `.om-eyebrow`.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.
It carries per-scene timings, the reading-time audit, and the beat locks.

Scene summary (times are absolute; scene boundaries are exact):
1. **Hook — la frase del hero** — 0.00→4.00 (4.00s) — sand field, breathing disc
   right, hero line in two beats (ink, then clay).
2. **La intención** — 4.00→8.74 (4.74s) — the real pill field; the intention types
   out character by character; "Continuar" dips; four real suggestion chips below.
3. **La anatomía** — 8.74→15.29 (6.55s) — the paper card lands on a strong cue,
   five rows arrive on the beat grid, the single clay dot pulses, then the line
   `Solo el punto de color se escribe para ti.`
4. **El reproductor** — 15.29→19.66 (4.37s) — cross into the dark `oscuro` theme;
   the disc breathes on the real 4-7-8 curve; `Inhala · 4` → `Suelta · 8`.
5. **Cierre** — 19.66→23.00 (3.34s) — wordmark lands on a strong cue, tagline,
   `omtana.com`, music gone before the image.

## Audio
- Audio role: **no music.** The soundtrack is diegetic — you hear what the
  product does, and nothing else. An upbeat corporate bed over a meditation app
  read as someone else's video, and silence is this brand's material.
- Music: **none.** A deliberate choice, not a missing asset. Do not add a bed.
- Audio arc: silence while the hook is read → typing and a click while the
  intention is entered → a barely-there thud as the card lands → silence while
  the anatomy is read → the breath, rising and falling with the disc → a bell on
  the wordmark, ringing out into silence.
- Layers and timings:
  - `assets/sfx/keyboard/keypress-*.wav` — 7 ticks, 5.127→6.487s, ~0.28-0.30.
  - `assets/sfx/interface/click_003.ogg` — 7.2s, 0.45.
  - `assets/sfx/impact/impactSoft_medium_001.ogg` — 8.7s, 0.18 (kept very low so
    it does not jolt against the silence around it).
  - `assets/sfx/breath/breath-in.wav` — 16.15s, 0.30.
  - `assets/sfx/breath/breath-out.wav` — 18.56s, 0.28.
  - `assets/sfx/impact/impactBell_heavy_000.ogg` — 19.62s, 0.40.
- The breath layer is synthesized the way the app synthesizes it: pink noise
  band-limited to a breath (260–1250 Hz in, 220–1050 Hz out), swelling on the
  inhale and releasing on the exhale. See `breath_sounds` in
  `src/lib/breathing.ts`. It exists so scene 4 is not eleven seconds of dead air.
- Audio-reactive treatment: **none** — with no music there is no energy to
  follow. The halo and the dark glow breathe on their own, on long counted
  cycles (`yoyo` + a finite `repeat`, never `repeat: -1`).
- Music cue guidance: not applicable. The edit's timings were kept because they
  are good pacing, but they no longer derive from any tempo grid.
- Restraint: no whooshes, no risers, no sound per card row, and nothing layered
  over the breath except the breath.
- Track allocation: SFX on ascending `data-track-index` from 11; the breath on
  21 and 22. Every `<audio>` needs a unique `id` or the render is silent.
- Voiceover: **none.**

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core`
(composition contract + `data-*` timing), `hyperframes-animation` (motion),
`hyperframes-creative` (design spec, beats, audio-reactive),
`hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli`
(lint/check/render). `/brag` is its own workflow: do not enter the `hyperframes`
entry-point intent interview and do not route into its generic promo /
launch-video workflow. Prefer native Hyperframes conventions over anything in
`/brag`.

Requirements:
- Show real UI, copy, and visual elements from the source project — three scenes
  of the five are recreations of actual screens.
- Keep all text readable in the final render; honor the reading-time audit in
  `brag-plan.md`.
- Keep the video at 23.0s.
- Include the planned SFX and breath layers. Do not add music.
- Keep the existing timings; they are pacing decisions now, not beat locks.
- Use SFX to support motion only, at the density listed.
- Let the closing bell ring out into silence; the last ~2s carry no audio.
- No audio-reactive wiring: ambient motion is self-contained.
- Use local assets for audio, fonts, and SVGs. GSAP from CDN is fine.
- Specific technical notes for this composition:
  - Light canvas for scenes 1–3, dark for 4–5. WCAG AA is gated by `check`:
    on sand `#f6f1e9`, body text must be `#4a4239` or darker; `#9a8f81` (faint)
    and `#b5aa9b` do **not** pass for real text — use them only for decoratives or
    step up to `#6b6157`/`#4a4239`. On `#231c17`, `#c4b9aa` and `#f6f1e9` pass;
    `#a79c8d` is borderline — verify, and darken the local background or lighten
    the text if `check` flags it. Apply the suggested compliant colour `check`
    reports rather than reaching for `--no-contrast`.
  - No full-screen linear gradient on the dark scenes (H.264 banding) — use a
    radial glow over a solid fill.
  - Reuse `barHeights()` verbatim for the wave; it is deterministic.
  - The breathing disc's ambient loop must use a finite `repeat` count computed
    with `Math.floor`, never `repeat: -1`.
  - Typing animation: drive it from the timeline (a seeded/index-based reveal),
    not from a clock or `Math.random`.
- Run `npx hyperframes check` before render — it is brag's single gate.
