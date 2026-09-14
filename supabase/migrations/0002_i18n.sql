-- Contenido traducible de la base.
--
-- Dos mecanismos, y cada uno resuelve un problema distinto:
--
-- 1. Bancos curados (intenciones, voces). El texto en español se queda en su
--    columna, que sigue siendo la fuente, y las traducciones van en `i18n`
--    como {"en": {"title": "...", ...}}. Al mostrar se busca el idioma y se
--    cae a la columna base si no está, así que una fila sin traducir sigue
--    funcionando igual que antes.
--
-- 2. Historial de créditos. Ahí el texto no es contenido sino un registro de
--    lo que pasó, así que se guarda una clave estable más sus parámetros y el
--    rótulo se arma al mostrarlo. `reason` se mantiene como texto legible para
--    quien mire la tabla a mano, y como respaldo de las filas viejas.

alter table omtana_intentions
  add column if not exists i18n jsonb not null default '{}'::jsonb;

alter table omtana_voices
  add column if not exists i18n jsonb not null default '{}'::jsonb;

alter table omtana_credit_ledger
  add column if not exists reason_key  text,
  add column if not exists reason_meta jsonb not null default '{}'::jsonb;

-- Filas existentes: las tres razones de texto fijo y la compra de créditos se
-- reconocen sin ambigüedad. El resto se queda sin clave y sigue mostrando
-- `reason` tal cual.
update omtana_credit_ledger
   set reason_key = 'pro_activated'
 where reason_key is null and reason = 'Suscripción Pro activada';

update omtana_credit_ledger
   set reason_key = 'refund_failed'
 where reason_key is null and reason = 'Devolución por generación fallida';

update omtana_credit_ledger
   set reason_key = 'free_included'
 where reason_key is null and reason like 'Personalización incluida en %';

update omtana_credit_ledger
   set reason_key  = 'credits_purchased',
       reason_meta = jsonb_build_object(
         'n', (regexp_match(reason, '^Compra de (\d+) crédito'))[1]::int
       )
 where reason_key is null and reason ~ '^Compra de \d+ crédito';

-- Lo que se gastó en una meditación guardaba el texto de la intención como
-- razón. Se reconoce por el cargo asociado a una meditación, y el título viaja
-- en los parámetros para poder mostrarlo en cualquier idioma.
update omtana_credit_ledger
   set reason_key  = 'meditation',
       reason_meta = jsonb_build_object('title', reason)
 where reason_key is null and meditation_id is not null and delta < 0;
