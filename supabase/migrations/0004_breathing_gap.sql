-- Respiro entre ciclos.
--
-- Contar cinco ciclos seguidos sin una sola palabra en medio suena a metrónomo.
-- Este hueco es donde caben los comentarios que acompañan — "vas bien",
-- "quedan dos", "la última" — y además le da al cuerpo un beat antes de volver
-- a empezar. En segundos, porque la grilla entera se mide en segundos.
alter table omtana_breathing_exercises
  add column if not exists gap_seconds integer not null default 0;
