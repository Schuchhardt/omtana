-- OAuth 2.1 para los MCP.
--
-- Con esto Omtana se conecta desde claude.ai (Conectores) y desde cualquier
-- cliente MCP con un botón "Conectar": la persona inicia sesión, aprueba, y el
-- cliente recibe un token que sirve solo para ese MCP. La lógica está en
-- src/lib/oauth/core.ts; acá solo lo que se guarda.
--
-- Igual que las sesiones y las llaves: de cada código y cada token se guarda
-- el sha256, nunca el valor. Un volcado de estas tablas no sirve para entrar.

-- ─────────────────────────────────────────── Clientes registrados

-- Solo los de registro dinámico (RFC 7591). Los que se presentan con un Client
-- ID Metadata Document (client_id = URL) no se guardan: se leen de su URL.
create table if not exists omtana_oauth_clients (
  client_id          text primary key,
  client_secret_hash text,
  client_name        text not null,
  client_uri         text,
  logo_uri           text,
  redirect_uris      text[] not null,
  grant_types        text[] not null default '{authorization_code,refresh_token}',
  token_endpoint_auth_method text not null default 'none'
                     check (token_endpoint_auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  application_type   text,
  -- sha256 de la IP que registró, para limitar registros por hora.
  registered_from    text,
  created_at         timestamptz not null default now()
);
create index if not exists omtana_oauth_clients_from_idx
  on omtana_oauth_clients (registered_from, created_at desc);

-- ─────────────────────────────────────────── Permisos

-- Una aprobación de la persona: "esta app puede usar este MCP con mi cuenta".
-- Revocarla corta todos sus tokens a la vez. Es lo que se lista en /perfil.
create table if not exists omtana_oauth_grants (
  id           uuid primary key default gen_random_uuid(),
  -- Sin FK: puede ser la URL de un documento de metadata.
  client_id    text not null,
  client_name  text not null,
  user_id      uuid not null references omtana_users(id) on delete cascade,
  scope        text not null,
  -- El MCP para el que sirven sus tokens (RFC 8707).
  resource     text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists omtana_oauth_grants_user_idx on omtana_oauth_grants (user_id, created_at desc);

-- ─────────────────────────────────────────── Códigos de autorización

create table if not exists omtana_oauth_codes (
  code_hash      text primary key,
  client_id      text not null,
  client_name    text not null,
  user_id        uuid not null references omtana_users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  scope          text not null,
  resource       text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  -- El permiso que salió de este código: si el código se reusa, se revoca.
  grant_id       uuid references omtana_oauth_grants(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists omtana_oauth_codes_expires_idx on omtana_oauth_codes (expires_at);

-- ─────────────────────────────────────────── Tokens

create table if not exists omtana_oauth_tokens (
  token_hash text primary key,
  grant_id   uuid not null references omtana_oauth_grants(id) on delete cascade,
  kind       text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  -- Un refresh token se usa una vez (rota). Si vuelve, es una copia robada.
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists omtana_oauth_tokens_grant_idx on omtana_oauth_tokens (grant_id);
create index if not exists omtana_oauth_tokens_expires_idx on omtana_oauth_tokens (expires_at);

-- ─────────────────────────────────────────── Cierre de acceso público

revoke all on omtana_oauth_clients from anon, authenticated;
revoke all on omtana_oauth_grants from anon, authenticated;
revoke all on omtana_oauth_codes from anon, authenticated;
revoke all on omtana_oauth_tokens from anon, authenticated;

-- Para aplicar solo esta migración sobre una base que ya tiene las anteriores:
--   npm run db:push -- --solo 0009
