-- Distribución y curaduría.
--
-- Dos cosas que hasta ahora vivían fuera de la base y por eso no se podían
-- automatizar:
--
-- 1. El video dejó de ser uno por meditación. El mismo audio sale en tres
--    formatos — 16:9 para YouTube, 9:16 para shorts/reels y 1:1 para el feed —
--    y cada uno es un archivo con su propio alto, su propio largo y sus
--    propios subtítulos. `omtana_video_exports` guardaba una fila por
--    meditación; ahora guarda una por meditación y formato.
--
-- 2. La curaduría del banco. Qué le falta al catálogo para estar equilibrado
--    se calcula leyendo la base (no hace falta guardarlo), pero lo que la
--    investigación propone sí: una intención nueva o un ejercicio de
--    respiración con la evidencia que lo respalda no se aplica solo — queda
--    propuesto y alguien lo aprueba.

-- ─────────────────────────────────────────── Video por formato

alter table omtana_video_exports
  add column if not exists format         text    not null default 'youtube',
  add column if not exists width          integer not null default 1920,
  add column if not exists height         integer not null default 1080,
  add column if not exists seconds        integer not null default 0,
  add column if not exists theme          text    not null default 'oscuro',
  add column if not exists subtitles_path text,
  -- Título, descripción, etiquetas y capítulos con los que se sube. Se arma al
  -- renderizar y se guarda para que subirlo no dependa de volver a calcularlo.
  add column if not exists metadata       jsonb   not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'omtana_video_exports'::regclass
       and conname  = 'omtana_video_exports_format_check'
  ) then
    alter table omtana_video_exports
      add constraint omtana_video_exports_format_check
      check (format in ('youtube', 'vertical', 'cuadrado'));
  end if;
end $$;

-- Una fila por meditación y formato. Antes se insertaba una fila nueva en cada
-- corrida, así que una meditación reintentada tres veces dejaba tres filas y
-- "¿tiene video?" había que responderlo mirando cuál era la última. Se limpia
-- lo viejo — es un derivado, el archivo sigue en el bucket — quedándose con la
-- fila lista más reciente, o con la más reciente si ninguna quedó lista.
delete from omtana_video_exports
 where id in (
   select id from (
     select id,
            row_number() over (
              partition by meditation_id, format
              order by (status = 'ready') desc, created_at desc
            ) as fila
       from omtana_video_exports
   ) ranked
   where fila > 1
 );

create unique index if not exists omtana_video_exports_key_idx
  on omtana_video_exports (meditation_id, format);

-- ─────────────────────────────────────────── Propuestas de contenido

-- Lo que la investigación semanal encuentra: una intención que le falta al
-- banco para cubrir un área de la vida, o un ejercicio de respiración con
-- respaldo publicado. `payload` es exactamente la fila que se insertaría, así
-- que aplicar una propuesta no vuelve a pasar por el modelo.
create table if not exists omtana_content_proposals (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('intention', 'breathing')),
  slug       text not null,
  payload    jsonb not null,
  -- El hueco que viene a llenar, en el vocabulario del informe: "salud/Foco",
  -- "sin ejercicio de exhalación larga". Es lo que justifica la propuesta.
  gap        text not null default '',
  rationale  text not null default '',
  -- [{"title": "...", "url": "...", "finding": "..."}] — de dónde sale que
  -- esto funciona. Una propuesta sin evidencia se puede aplicar igual, pero se
  -- ve en el informe que no la tiene.
  evidence   jsonb not null default '[]'::jsonb,
  status     text not null default 'proposed'
             check (status in ('proposed', 'applied', 'rejected')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, slug)
);
create index if not exists omtana_content_proposals_status_idx
  on omtana_content_proposals (status, created_at desc);

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
