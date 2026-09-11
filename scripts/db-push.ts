/**
 * Aplica las migraciones de supabase/migrations contra la base apuntada por
 * SUPABASE_DB_URL (la cadena de conexión directa de Postgres, no la URL de API).
 *
 *   npm run db:push
 *
 * Si prefieres no dar la cadena de Postgres, pega el archivo en el SQL editor
 * de Supabase: el script lo imprime con --print.
 */
import "./_bootstrap";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { log, parseArgs, fatal } from "./_bootstrap";

const DIR = "supabase/migrations";

async function main() {
  const args = parseArgs();
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) fatal(`No hay migraciones en ${DIR}.`);

  if (args.flags.has("print")) {
    for (const f of files) process.stdout.write(await readFile(join(DIR, f), "utf8"));
    return;
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    fatal(
      "Falta SUPABASE_DB_URL.\n" +
        "    Está en Supabase → Project Settings → Database → Connection string → URI.\n" +
        "    O corre: npm run db:push -- --print | pbcopy  y pégalo en el SQL editor.",
    );
  }

  log.title("Aplicando migraciones");

  for (const file of files) {
    log.step(file);
    const sql = await readFile(join(DIR, file), "utf8");
    await psql(url, sql);
    log.ok(`${file} aplicada`);
  }

  log.done("Base lista. Ahora: npm run seed");
}

function psql(url: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", () =>
      reject(
        new Error(
          "No se encontró psql. Instálalo (brew install libpq) o usa --print y el SQL editor.",
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`psql salió con ${code}`)),
    );
    child.stdin.end(sql);
  });
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
