/**
 * Aplica las migraciones que faltan, y solo esas.
 *
 *   npm run db:migrate              aplica lo pendiente
 *   npm run db:migrate -- --seco    dice qué aplicaría, sin tocar nada
 *
 * Usa SUPABASE_DB_URL (la cadena de conexión directa de Postgres) y psql, igual
 * que `db:push`. La diferencia es el registro: cada migración aplicada queda en
 * `omtana_schema_migrations`, así que correrlo dos veces no hace nada la
 * segunda. Lo corre el workflow `migraciones.yml` cuando se mergea a main.
 *
 * La primera vez, sobre la base viva, anota 0001–0007 como "baseline" (ya
 * estaban) sin correrlas. Sobre una base vacía las aplica todas.
 *
 * Cada migración corre en su propia transacción junto con su registro: si
 * falla, no queda a medias ni anotada, y el comando termina con error.
 */
import "./_bootstrap";
import { appendFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { fatal, log, parseArgs } from "./_bootstrap";
import {
  applySql,
  BASELINE_UP_TO,
  SKIPPED_MARKER,
  baselineSql,
  migrationFile,
  planMigrations,
  type DatabaseState,
  type MigrationPlan,
} from "./lib/migrations";

const DIR = "supabase/migrations";

function run(url: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [url, "-v", "ON_ERROR_STOP=1", "-X", ...args], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () =>
      reject(new Error("No se encontró psql. Instálalo (brew install libpq / apt install postgresql-client).")),
    );
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`psql salió con ${code}`))));
    child.stdin.end(input ?? "");
  });
}

async function readState(url: string): Promise<DatabaseState> {
  const flags = (
    await run(url, [
      "-At",
      "-F",
      "\t",
      "-c",
      "select to_regclass('public.omtana_schema_migrations') is not null, to_regclass('public.omtana_users') is not null",
    ])
  )
    .trim()
    .split("\t");
  const ledgerExists = flags[0] === "t";
  const schemaExists = flags[1] === "t";
  if (!ledgerExists) return { ledgerExists, schemaExists, applied: [] };

  const rows = (await run(url, ["-At", "-F", "\t", "-c", "select name, checksum from omtana_schema_migrations order by name"]))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, checksum] = line.split("\t");
      return { name, checksum };
    });
  return { ledgerExists, schemaExists, applied: rows };
}

function actor(): string {
  if (process.env.GITHUB_ACTOR) {
    return `github:${process.env.GITHUB_ACTOR}@${(process.env.GITHUB_SHA ?? "").slice(0, 7)}`;
  }
  try {
    return `local:${userInfo().username}`;
  } catch {
    return "local";
  }
}

function describe(plan: MigrationPlan): string[] {
  const lines: string[] = [];
  if (plan.baseline.length) {
    lines.push(`Primera vez con registro: se anotan como ya aplicadas ${plan.baseline.map((f) => f.name).join(", ")}.`);
  }
  lines.push(plan.pending.length ? `Pendientes: ${plan.pending.map((f) => f.name).join(", ")}.` : "No hay migraciones pendientes.");
  if (plan.changed.length) {
    lines.push(`Cambiaron después de aplicarse (no se re-aplican; revisa por qué): ${plan.changed.join(", ")}.`);
  }
  if (plan.missing.length) lines.push(`Anotadas en la base pero sin archivo: ${plan.missing.join(", ")}.`);
  if (plan.outOfOrder.length) {
    lines.push(`Fuera de orden (número menor que la última aplicada): ${plan.outOfOrder.join(", ")}.`);
  }
  return lines;
}

/** En GitHub Actions, el resumen queda en la página de la corrida. */
async function summary(lines: string[]) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, `### Migraciones\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`);
}

async function main() {
  const args = parseArgs();
  const dry = args.flags.has("seco");
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    fatal(
      "Falta SUPABASE_DB_URL.\n" +
        "    Está en Supabase → Project Settings → Database → Connection string → URI.",
    );
  }

  const names = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
  const files = await Promise.all(names.map(async (name) => migrationFile(name, await readFile(join(DIR, name), "utf8"))));

  log.title(dry ? "Migraciones (en seco)" : "Migraciones");
  const state = await readState(url);
  const plan = planMigrations(files, state, args.values.get("baseline") ?? BASELINE_UP_TO);
  const lines = describe(plan);
  for (const line of lines) (line.startsWith("Pendientes") || line.startsWith("No hay") ? log.step : log.warn)(line);

  if (dry) {
    await summary(["(en seco, no se aplicó nada)", ...lines]);
    log.done("En seco: no se tocó la base.");
    return;
  }

  const by = actor();
  if (!state.ledgerExists) {
    await run(url, ["-q", "--single-transaction", "-f", "-"], baselineSql(plan.baseline, by));
    log.ok(`Registro creado${plan.baseline.length ? ` con ${plan.baseline.length} migraciones de baseline` : ""}.`);
  }

  const applied: string[] = [];
  for (const file of plan.pending) {
    log.step(file.name);
    const { sql, transactional } = applySql(file, by);
    let out: string;
    try {
      out = await run(url, ["-q", ...(transactional ? ["--single-transaction"] : []), "-f", "-"], sql);
    } catch (err) {
      await summary([...lines, `**Falló ${file.name}**: no quedó aplicada (se revirtió entera). Aplicadas antes: ${applied.join(", ") || "ninguna"}.`]);
      fatal(`${file.name} falló y se revirtió: ${err instanceof Error ? err.message : err}`);
    }
    if (out.includes(SKIPPED_MARKER)) {
      log.info(`${file.name}: otra corrida la aplicó mientras esta esperaba; se salta`);
      continue;
    }
    applied.push(file.name);
    log.ok(`${file.name} aplicada`);
  }

  await summary([...lines, applied.length ? `Aplicadas: ${applied.join(", ")}.` : "Nada que aplicar."]);
  log.done(applied.length ? `Listo: ${applied.length} migración(es) aplicada(s).` : "La base ya estaba al día.");
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
