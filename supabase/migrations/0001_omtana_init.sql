-- Omtana — esquema inicial
-- Sin RLS y sin Supabase Auth: todo el acceso ocurre server-side con la service role key.
-- Se revocan los grants de anon/authenticated para que la base no quede legible
-- por PostgREST aunque la anon key se filtre. La service role los ignora (BYPASSRLS).

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────── Usuarios y sesión

create table omtana_users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  name             text not null,
  password_hash    text not null,
  plan             text not null default 'free' check (plan in ('free', 'pro')),
  credits          integer not null default 0 check (credits >= 0),
  free_used_period integer not null default 0,
  period_started   date not null default date_trunc('month', now())::date,
  locale           text not null default 'es' check (locale in ('es', 'en', 'pt')),
  default_voice_id uuid,
  default_duration integer not null default 15,
  prefs            jsonb not null default '{"daily_reminder":true,"voice_emails":true,"publish_by_default":false,"improve_service":true}'::jsonb,
  stripe_customer_id text,
  created_at       timestamptz not null default now()
);
-- Único sobre lower(email): "Seba@" y "seba@" son la misma cuenta, aunque el
-- insert venga de un script y no del formulario, que ya normaliza a minúsculas.
create unique index omtana_users_email_idx on omtana_users (lower(email));

create table omtana_sessions (
  token_hash text primary key,
  user_id    uuid not null references omtana_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index omtana_sessions_user_idx on omtana_sessions (user_id);
create index omtana_sessions_expires_idx on omtana_sessions (expires_at);

-- ─────────────────────────────────────────── Bancos: voces y música

create table omtana_voices (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  accent         text not null,
  gender         text not null check (gender in ('Femenina', 'Masculina')),
  tone           text not null check (tone in ('Grave', 'Media', 'Aguda')),
  languages      text[] not null default '{es}',
  blurb          text not null,
  provider_voice_id text,
  provider_settings jsonb not null default '{"stability":0.45,"similarity_boost":0.75,"speed":0.82}'::jsonb,
  sample_url     text,
  sort           integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table omtana_users
  add constraint omtana_users_default_voice_fk
  foreign key (default_voice_id) references omtana_voices(id) on delete set null;

create table omtana_music_tracks (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  mood       text not null,
  audio_path text not null,
  duration_seconds integer not null default 0,
  loopable   boolean not null default true,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────── Banco de intenciones y templates

create table omtana_intentions (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  summary    text not null default '',
  tag        text not null default '',
  category   text not null default 'general',
  durations  integer[] not null default '{5,10,15}',
  brief      text not null default '',
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table omtana_templates (
  id               uuid primary key default gen_random_uuid(),
  intention_id     uuid not null references omtana_intentions(id) on delete cascade,
  locale           text not null default 'es' check (locale in ('es', 'en', 'pt')),
  duration_minutes integer not null,
  voice_id         uuid references omtana_voices(id) on delete set null,
  breathing_pattern text not null default '4-7-8',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (intention_id, locale, duration_minutes, voice_id)
);

-- Secciones del template. kind='fixed' trae audio pregenerado;
-- kind='dynamic' se rellena al vuelo con el contexto del usuario.
create table omtana_template_sections (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references omtana_templates(id) on delete cascade,
  position     integer not null,
  kind         text not null check (kind in ('fixed', 'dynamic')),
  label        text not null,
  seconds      integer not null,
  script_text  text,
  audio_path   text,
  brief        text default '',
  created_at   timestamptz not null default now(),
  unique (template_id, position)
);

-- ─────────────────────────────────────────── Meditaciones

create table omtana_meditations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references omtana_users(id) on delete cascade,
  intention_id   uuid references omtana_intentions(id) on delete set null,
  template_id    uuid references omtana_templates(id) on delete set null,
  voice_id       uuid references omtana_voices(id) on delete set null,
  music_track_id uuid references omtana_music_tracks(id) on delete set null,
  title          text not null,
  intention_text text not null,
  context_text   text not null default '',
  locale         text not null default 'es' check (locale in ('es', 'en', 'pt')),
  duration_seconds integer not null default 0,
  source         text not null default 'user' check (source in ('curated', 'user')),
  visibility     text not null default 'private' check (visibility in ('private', 'public')),
  status         text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'failed')),
  audio_path     text,
  keywords       text[] not null default '{}',
  plays          integer not null default 0,
  created_at     timestamptz not null default now(),
  ready_at       timestamptz
);
create index omtana_meditations_user_idx on omtana_meditations (user_id, created_at desc);
create index omtana_meditations_catalog_idx on omtana_meditations (visibility, status, created_at desc);
create index omtana_meditations_intention_idx on omtana_meditations (intention_id);

create table omtana_meditation_segments (
  id             uuid primary key default gen_random_uuid(),
  meditation_id  uuid not null references omtana_meditations(id) on delete cascade,
  position       integer not null,
  kind           text not null check (kind in ('fixed', 'dynamic')),
  label          text not null,
  script_text    text not null default '',
  audio_path     text,
  start_offset_seconds integer not null default 0,
  seconds        integer not null default 0,
  unique (meditation_id, position)
);

-- Palabras clave con timestamp, para el reproductor y para el video
create table omtana_meditation_cues (
  id            uuid primary key default gen_random_uuid(),
  meditation_id uuid not null references omtana_meditations(id) on delete cascade,
  at_seconds    integer not null,
  word          text not null
);
create index omtana_meditation_cues_idx on omtana_meditation_cues (meditation_id, at_seconds);

-- ─────────────────────────────────────────── Escuchas, créditos, jobs

create table omtana_plays (
  id               uuid primary key default gen_random_uuid(),
  meditation_id    uuid not null references omtana_meditations(id) on delete cascade,
  user_id          uuid references omtana_users(id) on delete set null,
  seconds_listened integer not null default 0,
  completed        boolean not null default false,
  created_at       timestamptz not null default now()
);
create index omtana_plays_meditation_idx on omtana_plays (meditation_id);
create index omtana_plays_user_idx on omtana_plays (user_id, created_at desc);

create table omtana_credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references omtana_users(id) on delete cascade,
  delta         integer not null,
  reason        text not null,
  meditation_id uuid references omtana_meditations(id) on delete set null,
  stripe_ref    text,
  created_at    timestamptz not null default now()
);
create index omtana_credit_ledger_user_idx on omtana_credit_ledger (user_id, created_at desc);

create table omtana_generation_jobs (
  id            uuid primary key default gen_random_uuid(),
  meditation_id uuid not null references omtana_meditations(id) on delete cascade,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  step          text not null default 'script',
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index omtana_generation_jobs_meditation_idx on omtana_generation_jobs (meditation_id, created_at desc);

create table omtana_video_exports (
  id            uuid primary key default gen_random_uuid(),
  meditation_id uuid not null references omtana_meditations(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'rendering', 'ready', 'failed')),
  video_path    text,
  youtube_url   text,
  error         text,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

create table omtana_leads (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  locale     text not null default 'es',
  source     text not null default 'landing',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────── Cierre de acceso público

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
