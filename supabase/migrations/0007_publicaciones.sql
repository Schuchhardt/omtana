-- Publicaciones en redes.
--
-- Hasta ahora "¿se publicó?" era una sola columna en el export (`youtube_url`),
-- porque el único destino era YouTube. Con Zernio el mismo archivo sale a
-- varias redes, cada una con su propio estado, su propia URL y su propio
-- error, y un post programado puede cancelarse antes de salir. Eso pide una
-- fila por (export, red, cuenta).
--
-- `youtube_url` y `published_at` en `omtana_video_exports` se siguen llenando
-- cuando la red es YouTube, para que lo que ya lee esas columnas no cambie.

-- ─────────────────────────────────────────── Publicaciones

create table if not exists omtana_publications (
  id                   uuid primary key default gen_random_uuid(),
  export_id            uuid not null references omtana_video_exports(id) on delete cascade,
  meditation_id        uuid not null references omtana_meditations(id) on delete cascade,
  platform             text not null
                       check (platform in ('youtube', 'instagram', 'tiktok', 'facebook', 'threads')),
  -- El id de la cuenta conectada en el proveedor, no un usuario nuestro.
  account_id           text not null,
  provider             text not null default 'zernio',
  -- El id del post en el proveedor. Un post de Zernio cubre varias redes, así
  -- que varias filas pueden compartirlo.
  provider_post_id     text,
  -- Determinista a partir del export y las redes: repetir el comando no
  -- duplica el post.
  request_id           uuid not null,
  status               text not null default 'queued'
                       check (status in ('queued', 'scheduled', 'publishing', 'published',
                                         'partial', 'failed', 'cancelled')),
  scheduled_for        timestamptz,
  published_at         timestamptz,
  -- La URL pública del post en la red, cuando ya salió.
  url                  text,
  error                text,
  error_category       text,
  -- El archivo subido al proveedor y hasta cuándo sirve esa URL (siete días).
  media_url            text,
  media_url_expires_at timestamptz,
  -- El cuerpo exacto que se mandó, para poder mirar qué se pidió.
  payload              jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (export_id, platform, account_id)
);

create index if not exists omtana_publications_status_idx
  on omtana_publications (status, scheduled_for);
create index if not exists omtana_publications_provider_post_idx
  on omtana_publications (provider_post_id);

-- ─────────────────────────────────────────── Exports sin archivo en el bucket

-- Hay exports en `ready` con `video_path` nulo: el 16:9 largo pasó el techo
-- de subida del bucket y quedó solo en `out/video/` de la máquina que lo
-- renderizó. No se marcan `failed`: el archivo local es válido y es el que se
-- publica. `scripts/publish-zernio.ts` acepta `video_path` nulo cuando
-- encuentra el archivo en `--desde` (por defecto `out/video`), y avisa y salta
-- si no lo encuentra en ninguno de los dos lados.

-- ─────────────────────────────────────────── Cierre de acceso público

revoke all on omtana_publications from anon, authenticated;

-- Para aplicar solo esta migración sobre una base que ya tiene las anteriores:
--   npm run db:push -- --solo 0007
