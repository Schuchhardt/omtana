import { createHash } from "node:crypto";

/**
 * Qué migraciones faltan aplicar, sin tocar la base: la parte de
 * `npm run db:migrate` que se puede probar con datos en la mano.
 *
 * Hasta ahora las migraciones no llevaban registro de cuáles ya corrieron, así
 * que aplicarlas era a mano y de a una (`db:push -- --solo 0008`). Desde acá,
 * cada migración aplicada queda en `omtana_schema_migrations` con un checksum,
 * y el comando aplica solo las que no están.
 *
 * El primer día la tabla no existe, pero la base de producción ya tiene todo lo
 * de 0001–0007: esas se anotan como "baseline" sin correrlas. En una base vacía
 * (un entorno nuevo) no hay baseline y se aplican todas desde la primera.
 */

/** Hasta dónde llegaba la base viva cuando se introdujo el registro. */
export const BASELINE_UP_TO = "0007";

/** Solo nombres como `0008_mcp.sql`: entran a SQL, así que no se aceptan otros. */
export const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Una migración que no puede correr dentro de una transacción lo declara así. */
export const NO_TRANSACTION_MARKER = "-- omtana:sin-transaccion";

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
}

export interface DatabaseState {
  /** ¿Existe `omtana_schema_migrations`? */
  ledgerExists: boolean;
  /** ¿Existe el esquema de Omtana (`omtana_users`)? Distingue una base viva de una vacía. */
  schemaExists: boolean;
  applied: AppliedMigration[];
}

export interface MigrationPlan {
  /** Migraciones que se anotan como ya aplicadas sin correrlas (solo el primer día). */
  baseline: MigrationFile[];
  /** Las que hay que aplicar, en orden. */
  pending: MigrationFile[];
  /** Aplicadas cuyo archivo cambió después: no se re-aplican, pero hay que mirarlo. */
  changed: string[];
  /** Anotadas en la base pero sin archivo: alguien borró o renombró una migración. */
  missing: string[];
  /** Pendientes con número menor que la última aplicada: se aplican, con aviso. */
  outOfOrder: string[];
}

export function checksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export function migrationFile(name: string, sql: string): MigrationFile {
  if (!MIGRATION_NAME.test(name)) {
    throw new Error(`Nombre de migración inválido: ${name}. Tiene que ser como 0008_algo.sql.`);
  }
  return { name, sql, checksum: checksum(sql) };
}

const number = (name: string) => name.slice(0, 4);

export function planMigrations(
  files: MigrationFile[],
  state: DatabaseState,
  baselineUpTo: string = BASELINE_UP_TO,
): MigrationPlan {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  for (const f of sorted) {
    if (seen.has(number(f.name))) throw new Error(`Hay dos migraciones con el número ${number(f.name)}.`);
    seen.add(number(f.name));
  }

  if (!state.ledgerExists) {
    // Primer día con registro. En una base viva, lo que ya estaba se anota sin correrlo.
    const baseline = state.schemaExists ? sorted.filter((f) => number(f.name) <= baselineUpTo) : [];
    const done = new Set(baseline.map((f) => f.name));
    return {
      baseline,
      pending: sorted.filter((f) => !done.has(f.name)),
      changed: [],
      missing: [],
      outOfOrder: [],
    };
  }

  const applied = new Map(state.applied.map((a) => [a.name, a.checksum]));
  const byName = new Map(sorted.map((f) => [f.name, f]));
  const pending = sorted.filter((f) => !applied.has(f.name));
  const lastApplied = [...applied.keys()].sort().at(-1) ?? "";

  return {
    baseline: [],
    pending,
    changed: [...applied.entries()]
      .filter(([name, sum]) => byName.has(name) && byName.get(name)!.checksum !== sum)
      .map(([name]) => name),
    missing: [...applied.keys()].filter((name) => !byName.has(name)).sort(),
    outOfOrder: pending.filter((f) => f.name < lastApplied).map((f) => f.name),
  };
}

/** Texto seguro para meter en un literal SQL (los nombres ya vienen validados). */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export const LEDGER_SQL = `create table if not exists omtana_schema_migrations (
  name       text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default '',
  -- true: estaba aplicada antes de que existiera este registro; no corrió acá.
  baseline   boolean not null default false
);
revoke all on omtana_schema_migrations from anon, authenticated;`;

/** Lo que imprime psql cuando otra corrida ya aplicó la migración. */
export const SKIPPED_MARKER = "OMTANA_MIGRACION_YA_APLICADA";

/** Un número fijo para el candado: dos corridas a la vez no aplican lo mismo dos veces. */
export const ADVISORY_LOCK_KEY = 4_206_031_337;

/**
 * El script de psql que aplica una migración y la anota, en la misma
 * transacción: o queda aplicada y registrada, o ninguna de las dos.
 *
 * Primero toma un candado y, ya con él, vuelve a mirar el registro: si otra
 * corrida la aplicó mientras esta esperaba, se salta (`\if` de psql). Así dos
 * corridas a la vez no aplican lo mismo dos veces, aunque la migración no sea
 * idempotente.
 */
export function applySql(file: MigrationFile, appliedBy: string): { sql: string; transactional: boolean } {
  const record = `insert into omtana_schema_migrations (name, checksum, applied_by)
values (${sqlString(file.name)}, ${sqlString(file.checksum)}, ${sqlString(appliedBy)})
on conflict (name) do nothing;`;

  if (file.sql.includes(NO_TRANSACTION_MARKER)) {
    // Sin transacción no hay candado de transacción: la protege la concurrencia del workflow.
    return { sql: `${file.sql}\n;\n${record}\n`, transactional: false };
  }
  return {
    transactional: true,
    sql: `select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY});
select exists (select 1 from omtana_schema_migrations where name = ${sqlString(file.name)}) as ya_aplicada \\gset
\\if :ya_aplicada
\\echo ${SKIPPED_MARKER}
\\else
${file.sql}
;
${record}
\\endif
`,
  };
}

export function baselineSql(files: MigrationFile[], appliedBy: string): string {
  const rows = files
    .map((f) => `(${sqlString(f.name)}, ${sqlString(f.checksum)}, ${sqlString(appliedBy)}, true)`)
    .join(",\n  ");
  return `${LEDGER_SQL}
${files.length ? `insert into omtana_schema_migrations (name, checksum, applied_by, baseline) values\n  ${rows}\non conflict (name) do nothing;` : ""}
`;
}
