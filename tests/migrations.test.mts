/**
 * Qué migraciones aplica `npm run db:migrate`, sin base: el plan sale del
 * registro (`omtana_schema_migrations`) y de los archivos.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applySql,
  baselineSql,
  checksum,
  migrationFile,
  NO_TRANSACTION_MARKER,
  planMigrations,
  SKIPPED_MARKER,
} from "../scripts/lib/migrations";

const files = [
  migrationFile("0001_init.sql", "create table a (id int);"),
  migrationFile("0002_mas.sql", "alter table a add column b int;"),
  migrationFile("0007_publicaciones.sql", "create table c (id int);"),
  migrationFile("0008_mcp.sql", "create table if not exists d (id int);"),
  migrationFile("0009_oauth.sql", "create table if not exists e (id int);"),
];
const names = (list: { name: string }[]) => list.map((f) => f.name);

describe("plan", () => {
  test("base viva sin registro: hasta 0007 es baseline, lo demás se aplica", () => {
    const plan = planMigrations(files, { ledgerExists: false, schemaExists: true, applied: [] });
    assert.deepEqual(names(plan.baseline), ["0001_init.sql", "0002_mas.sql", "0007_publicaciones.sql"]);
    assert.deepEqual(names(plan.pending), ["0008_mcp.sql", "0009_oauth.sql"]);
  });

  test("base vacía: no hay baseline, se aplican todas en orden", () => {
    const plan = planMigrations([...files].reverse(), { ledgerExists: false, schemaExists: false, applied: [] });
    assert.deepEqual(plan.baseline, []);
    assert.deepEqual(names(plan.pending), names(files));
  });

  test("con registro: solo lo que falta", () => {
    const applied = files.slice(0, 4).map((f) => ({ name: f.name, checksum: f.checksum }));
    const plan = planMigrations(files, { ledgerExists: true, schemaExists: true, applied });
    assert.deepEqual(names(plan.pending), ["0009_oauth.sql"]);
    assert.deepEqual(plan.changed, []);
  });

  test("al día: nada pendiente", () => {
    const applied = files.map((f) => ({ name: f.name, checksum: f.checksum }));
    assert.deepEqual(planMigrations(files, { ledgerExists: true, schemaExists: true, applied }).pending, []);
  });

  test("avisa si un archivo cambió después de aplicarse, si falta uno o si llega uno fuera de orden", () => {
    const applied = [
      { name: "0001_init.sql", checksum: "otro" },
      { name: "0002_mas.sql", checksum: files[1].checksum },
      { name: "0008_mcp.sql", checksum: files[3].checksum },
      { name: "0005_borrada.sql", checksum: "x" },
    ];
    const plan = planMigrations(files, { ledgerExists: true, schemaExists: true, applied });
    assert.deepEqual(plan.changed, ["0001_init.sql"]);
    assert.deepEqual(plan.missing, ["0005_borrada.sql"]);
    assert.deepEqual(plan.outOfOrder, ["0007_publicaciones.sql"]);
    assert.deepEqual(names(plan.pending), ["0007_publicaciones.sql", "0009_oauth.sql"]);
  });

  test("dos migraciones con el mismo número es un error", () => {
    assert.throws(
      () => planMigrations([...files, migrationFile("0008_otra.sql", "select 1;")], { ledgerExists: true, schemaExists: true, applied: [] }),
      /0008/,
    );
  });

  test("solo nombres seguros: entran a SQL", () => {
    assert.throws(() => migrationFile("0010_x'; drop table a;--.sql", ""), /inválido/);
    assert.throws(() => migrationFile("nueva.sql", ""), /inválido/);
  });

  test("el checksum no depende de los saltos de línea de Windows", () => {
    assert.equal(checksum("a\r\nb"), checksum("a\nb"));
  });
});

describe("SQL que se ejecuta", () => {
  test("cada migración va con su registro, bajo candado y salteable si otra corrida llegó antes", () => {
    const { sql, transactional } = applySql(files[3], "github:seba@abc1234");
    assert.equal(transactional, true);
    assert.match(sql, /^select pg_advisory_xact_lock\(\d+\);/);
    assert.match(sql, /\\gset\n\\if :ya_aplicada/);
    assert.ok(sql.includes(`\\echo ${SKIPPED_MARKER}`));
    assert.ok(sql.indexOf(files[3].sql) < sql.indexOf("insert into omtana_schema_migrations"));
    assert.match(sql, /values \('0008_mcp\.sql', '[0-9a-f]{64}', 'github:seba@abc1234'\)/);
    assert.match(sql, /\\endif\n$/);
  });

  test("una migración que declara que no puede ir en transacción corre aparte", () => {
    const file = migrationFile("0010_indice.sql", `${NO_TRANSACTION_MARKER}\ncreate index concurrently x on a (id);`);
    const { sql, transactional } = applySql(file, "local");
    assert.equal(transactional, false);
    assert.doesNotMatch(sql, /advisory/);
  });

  test("el baseline crea el registro y anota sin correr", () => {
    const sql = baselineSql(files.slice(0, 2), "local");
    assert.match(sql, /create table if not exists omtana_schema_migrations/);
    assert.match(sql, /revoke all on omtana_schema_migrations from anon, authenticated/);
    assert.match(sql, /\('0001_init\.sql', '[0-9a-f]{64}', 'local', true\)/);
    assert.doesNotMatch(sql, /create table a/);
  });

  test("las comillas en quien aplica no rompen el SQL", () => {
    assert.match(applySql(files[0], "local:o'brien").sql, /'local:o''brien'/);
  });
});
