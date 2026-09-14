-- Respiración guiada como pieza propia.
--
-- Antes la apertura era un bloque más del guion: el modelo escribía "inhala,
-- dos, tres, cuatro" y la voz lo leía al ritmo que le salía. El conteo se
-- desfasaba del reloj — el uno y el dos caían bien y el tres y el cuatro se
-- apuraban — porque nada garantizaba que un segundo hablado durara un segundo.
--
-- Ahora el ejercicio es una estructura de tiempo, no prosa: fases con su
-- duración exacta, y un audio que se arma poniendo cada señal en su segundo.
-- Ese audio se pregenera a mano (`npm run respiracion`) y se reutiliza; la
-- meditación ya no lo incluye, así que se puede prender, apagar o cambiar en
-- el reproductor sin regenerar nada.

-- ─────────────────────────────────────────── Banco de ejercicios

create table omtana_breathing_exercises (
  id       uuid primary key default gen_random_uuid(),
  slug     text not null unique,
  name     text not null,
  summary  text not null default '',
  -- Las fases de un ciclo, en orden:
  -- [{"kind":"inhale","seconds":4},{"kind":"hold","seconds":7},...]
  -- `level` (0..1) es qué tan llenos quedan los pulmones al terminar la fase;
  -- de ahí sale la animación. `cue` cambia la frase que se dice al empezarla.
  phases   jsonb not null,
  min_cycles integer not null default 2 check (min_cycles > 0),
  max_cycles integer not null default 8 check (max_cycles >= min_cycles),
  -- Si se cuenta segundo a segundo dentro de cada fase, o solo se nombra.
  counted  boolean not null default true,
  lead_in_seconds integer not null default 12,
  tail_seconds    integer not null default 8,
  i18n     jsonb not null default '{}'::jsonb,
  sort     integer not null default 0,
  active   boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────── Señales sueltas

-- Cada palabra que puede decirse en un ejercicio, sintetizada una sola vez por
-- voz e idioma: "inhala", "sostén", los números, la entrada y el cierre. Un
-- ejercicio se arma pegando estas señales en su segundo exacto, así que sumar
-- un ejercicio nuevo no cuesta síntesis si reutiliza el vocabulario.
create table omtana_breathing_cues (
  id        uuid primary key default gen_random_uuid(),
  voice_id  uuid not null references omtana_voices(id) on delete cascade,
  locale    text not null check (locale in ('es', 'en', 'pt')),
  slug      text not null,
  text      text not null,
  audio_path text not null,
  duration_seconds numeric(6,3) not null default 0,
  created_at timestamptz not null default now(),
  unique (voice_id, locale, slug)
);

-- ─────────────────────────────────────────── Ejercicios ya armados

-- Un ejercicio rendido para una voz, un idioma y un hueco de tiempo. El hueco
-- lo fija la sesión (60 s en las de 5 min, 120 s en el resto) y el ejercicio
-- mete los ciclos que le caben; `seconds` es lo que realmente dura, que puede
-- ser menos que el hueco. `timeline` guarda qué se dice y en qué segundo: es
-- lo que verifica el script y lo que anima el reproductor.
create table omtana_breathing_renders (
  id           uuid primary key default gen_random_uuid(),
  exercise_id  uuid not null references omtana_breathing_exercises(id) on delete cascade,
  voice_id     uuid not null references omtana_voices(id) on delete cascade,
  locale       text not null check (locale in ('es', 'en', 'pt')),
  slot_seconds integer not null,
  cycles       integer not null,
  seconds      integer not null,
  audio_path   text not null,
  timeline     jsonb not null default '[]'::jsonb,
  steps        jsonb not null default '[]'::jsonb,
  -- Resultado de la última verificación: desfase medido de cada señal.
  checked_at   timestamptz,
  check_report jsonb,
  created_at   timestamptz not null default now(),
  unique (exercise_id, voice_id, locale, slot_seconds)
);
create index omtana_breathing_renders_lookup_idx
  on omtana_breathing_renders (voice_id, locale, slot_seconds);

-- ─────────────────────────────────────────── Meditaciones

alter table omtana_meditations
  add column if not exists breathing_exercise_id uuid
    references omtana_breathing_exercises(id) on delete set null,
  -- El hueco que la sesión le reserva a la respiración. Se guarda al crearla
  -- porque `duration_seconds` termina midiendo solo el cuerpo.
  add column if not exists breathing_slot_seconds integer not null default 0,
  -- 1: la respiración venía dentro del audio. 2: va aparte y es opcional.
  -- El reproductor no ofrece la capa de respiración sobre una v1, o sonarían
  -- las dos.
  add column if not exists plan_version integer not null default 1;

-- ─────────────────────────────────────────── Plantillas

-- El reparto de secciones cambió (la apertura ya no es un bloque de guion), así
-- que las plantillas viejas no sirven para las sesiones nuevas: sus posiciones
-- están corridas en uno. Conviven separadas por versión en vez de borrarse.
alter table omtana_templates
  add column if not exists plan_version integer not null default 1;

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'omtana_templates'::regclass and contype = 'u'
  loop
    execute format('alter table omtana_templates drop constraint %I', c);
  end loop;
end $$;

create unique index if not exists omtana_templates_key_idx
  on omtana_templates (intention_id, locale, duration_minutes, voice_id, plan_version);

-- ─────────────────────────────────────────── Cierre de acceso público

do $$
declare t record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'omtana\_%'
  loop
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;
