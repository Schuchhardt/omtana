-- MCP: acceso por asistentes, costos y bitácora.
--
-- Tres cosas que los servidores MCP (`/api/mcp` y `/api/mcp/admin`) necesitan
-- y que hasta ahora no existían en la base:
--
-- 1. Llaves de API por persona. Un asistente (Claude, Cursor…) no tiene la
--    cookie de sesión del navegador: se presenta con `Authorization: Bearer
--    omt_…`. En la base va solo el hash, igual que las sesiones.
--
-- 2. Uso y costo de cada llamada a un proveedor. Antes "¿cuánto costó esta
--    meditación?" no tenía respuesta: los tokens del modelo y los caracteres de
--    la voz se gastaban y no quedaban en ninguna parte. Ahora cada llamada deja
--    una fila con lo que midió el proveedor y el costo estimado en USD, colgada
--    de la meditación, el job o la plantilla que la pidió.
--
-- 3. Una bitácora. Los avisos al equipo, los pasos de cada generación con su
--    hora y cada llamada a una herramienta MCP. Es lo que permite reconstruir
--    la traza de una sesión (cuánto tardó cada paso) sin ir a buscar logs de
--    Netlify.
--
-- Más dos columnas en las meditaciones: si el guion lo trajo la persona y por
-- dónde se pidió (web, MCP, admin, CLI).

-- ─────────────────────────────────────────── Llaves de API

create table if not exists omtana_api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references omtana_users(id) on delete cascade,
  name         text not null default 'Asistente',
  -- sha256 de la llave. La llave entera se muestra una sola vez, al crearla.
  token_hash   text not null unique,
  -- Los primeros caracteres, para reconocerla en la lista sin poder usarla.
  prefix       text not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists omtana_api_keys_user_idx on omtana_api_keys (user_id, created_at desc);

-- ─────────────────────────────────────────── Uso y costos

create table if not exists omtana_usage_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('anthropic', 'elevenlabs')),
  -- El modelo que de verdad respondió (con fallbacks puede no ser el pedido).
  model         text not null default '',
  -- Para qué fue: guion, plantilla, prompt, voz, curaduria, video, respiracion…
  operation     text not null default '',
  meditation_id uuid references omtana_meditations(id) on delete set null,
  job_id        uuid references omtana_generation_jobs(id) on delete set null,
  template_id   uuid references omtana_templates(id) on delete set null,
  user_id       uuid references omtana_users(id) on delete set null,
  -- web | mcp | admin | cli | worker
  via           text not null default '',
  input_tokens          integer not null default 0,
  output_tokens         integer not null default 0,
  cache_read_tokens     integer not null default 0,
  cache_creation_tokens integer not null default 0,
  -- De output_tokens, cuántos fueron razonamiento (si el proveedor lo informa).
  thinking_tokens       integer,
  web_search_requests   integer not null default 0,
  -- ElevenLabs cobra por caracter.
  characters            integer not null default 0,
  -- Estimado con la tabla de precios de src/lib/pricing.ts al momento de la
  -- llamada. Nulo si el modelo no estaba en la tabla.
  cost_usd      numeric(12, 6),
  duration_ms   integer,
  -- request id del proveedor, fallbacks, stop_reason… lo que ayude a rastrear.
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists omtana_usage_events_created_idx on omtana_usage_events (created_at desc);
create index if not exists omtana_usage_events_meditation_idx on omtana_usage_events (meditation_id);
create index if not exists omtana_usage_events_user_idx on omtana_usage_events (user_id, created_at desc);
create index if not exists omtana_usage_events_operation_idx on omtana_usage_events (operation, created_at desc);

-- ─────────────────────────────────────────── Bitácora

create table if not exists omtana_logs (
  id            uuid primary key default gen_random_uuid(),
  level         text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  -- generation | alert | mcp:user | mcp:admin | api | worker …
  source        text not null,
  message       text not null,
  meditation_id uuid references omtana_meditations(id) on delete set null,
  job_id        uuid references omtana_generation_jobs(id) on delete set null,
  user_id       uuid references omtana_users(id) on delete set null,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists omtana_logs_created_idx on omtana_logs (created_at desc);
create index if not exists omtana_logs_level_idx on omtana_logs (level, created_at desc);
create index if not exists omtana_logs_meditation_idx on omtana_logs (meditation_id, created_at);
create index if not exists omtana_logs_source_idx on omtana_logs (source, created_at desc);

-- ─────────────────────────────────────────── Meditaciones

alter table omtana_meditations
  -- null: el guion lo escribe el modelo (lo de siempre).
  -- 'tramo': la persona trajo el texto del tramo personalizado; los bloques
  --          fijos siguen saliendo de la plantilla de la intención.
  -- 'completo': la meditación entera es el texto de la persona.
  add column if not exists script_mode text
    check (script_mode is null or script_mode in ('tramo', 'completo')),
  add column if not exists script_override text,
  add column if not exists created_via text not null default 'web';

-- ─────────────────────────────────────────── Cierre de acceso público

revoke all on omtana_api_keys from anon, authenticated;
revoke all on omtana_usage_events from anon, authenticated;
revoke all on omtana_logs from anon, authenticated;

-- Para aplicar solo esta migración sobre una base que ya tiene las anteriores:
--   npm run db:push -- --solo 0008
