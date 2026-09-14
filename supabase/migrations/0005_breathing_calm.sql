-- Que la respiración suene a guía y no a metrónomo.
--
-- Contar cada segundo obliga a decir cada palabra en menos de un segundo, y a
-- ese ritmo la voz suena apurada — que es justo lo contrario de lo que hace un
-- ejercicio de respiración. `counting` elige cuánto se cuenta: todos los
-- segundos, solo el último de cada fase (queda el hito y el resto es silencio),
-- o nada. Con menos palabras, cada una se puede decir lento.
alter table omtana_breathing_exercises
  add column if not exists counting text not null default 'last'
    check (counting in ('all', 'last', 'none')),
  -- Un sonido de aire, generado y puesto debajo de la voz, para que se note
  -- dónde entra y dónde sale sin tener que decirlo.
  add column if not exists breath_sounds boolean not null default true;

-- `counted` era booleano: contar o no contar. Lo reemplaza `counting`, que
-- además tiene el término medio, que es el que suena bien.
update omtana_breathing_exercises
   set counting = case when counted then 'last' else 'none' end
 where counted is not null;

alter table omtana_breathing_exercises drop column if exists counted;
