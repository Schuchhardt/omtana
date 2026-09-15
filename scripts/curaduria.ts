/**
 * Curaduría del banco: qué le falta y con qué llenarlo.
 *
 *   npm run curaduria                        el informe, sin gastar nada
 *   npm run curaduria -- --investigar        propone lo que falta, con evidencia
 *   npm run curaduria -- --propuestas        lo propuesto y sin aplicar
 *   npm run curaduria -- --aplicar <slug>    lo mete al banco
 *   npm run curaduria -- --aplicar todas
 *   npm run curaduria -- --rechazar <slug>
 *   npm run curaduria -- --markdown          el informe tal cual, para pegarlo
 *
 * El informe se calcula leyendo la base y no cuesta nada, así que se puede
 * correr todas las veces que haga falta. `--investigar` sí gasta: llama al
 * modelo con búsqueda web y deja propuestas, que **no** se aplican solas.
 */
import "./_bootstrap";
import { appendFile } from "node:fs/promises";
import { log, requireEnv, parseArgs, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { balance, type BalanceReport } from "../src/lib/curation/balance";
import { research, type Proposal } from "../src/lib/curation/research";
import { markdown } from "../src/lib/curation/report";

interface ProposalRow {
  id: string;
  kind: "intention" | "breathing";
  slug: string;
  payload: Record<string, unknown>;
  gap: string;
  rationale: string;
  evidence: { title: string; url: string; finding: string }[];
  status: string;
  created_at: string;
}

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const args = parseArgs();

  if (args.values.has("aplicar")) return apply(args.values.get("aplicar")!);
  if (args.values.has("rechazar")) return reject(args.values.get("rechazar")!);
  if (args.flags.has("propuestas")) return listProposals();

  const report = await balance();

  const asMarkdown = args.flags.has("markdown");

  if (args.flags.has("investigar")) {
    requireEnv("ANTHROPIC_API_KEY");
    const proposals = await investigate(report, args, asMarkdown);
    await emit(report, proposals, asMarkdown);
    return;
  }

  await emit(report, [], asMarkdown);
}

/* ───────────────────────── informe ───────────────────────── */

async function emit(report: BalanceReport, proposals: Proposal[], asMarkdown: boolean) {
  const text = markdown(report, proposals);

  if (asMarkdown) {
    console.log(text);
  } else {
    print(report, proposals);
  }

  // En Actions el informe queda en el resumen del job, que es donde se mira.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, `${text}\n`);
}

function print(report: BalanceReport, proposals: Proposal[]) {
  log.title("Equilibrio del banco");
  log.info(
    `${report.totals.intentions} intenciones · ${report.totals.meditations} sesiones públicas · ` +
      `${report.totals.videos} videos · ${report.totals.exercises} ejercicios`,
  );
  if (report.totals.retired > 0) {
    log.info(`${report.totals.retired} sesión(es) más, de intenciones ya retiradas del banco`);
  }

  console.log("");
  log.step("Por área de la vida");
  for (const row of report.areas) {
    log.info(
      `${row.key.padEnd(12)} ${String(row.intentions).padStart(3)} intenciones  ` +
        `${String(row.meditations).padStart(3)} sesiones  ${String(row.videos).padStart(3)} con video`,
    );
  }

  console.log("");
  log.step("Por necesidad");
  for (const row of report.needs) {
    log.info(
      `${row.key.padEnd(14)} ${String(row.intentions).padStart(3)} intenciones  ` +
        `${String(row.meditations).padStart(3)} sesiones`,
    );
  }

  console.log("");
  log.step("Respiración");
  for (const family of report.breathing.families) {
    const covered = family.exercises.length > 0;
    const line = `${family.label}: ${covered ? family.exercises.join(", ") : "sin cubrir"}`;
    if (covered) log.info(line);
    else log.warn(line);
  }

  console.log("");
  log.step(`Huecos (${report.gaps.length})`);
  for (const gap of report.gaps.slice(0, 15)) log.info(`${gap.kind.padEnd(11)} ${gap.label}`);
  if (report.gaps.length > 15) log.info(`… y ${report.gaps.length - 15} más`);

  if (proposals.length > 0) {
    console.log("");
    log.step(`Propuestas nuevas (${proposals.length})`);
    for (const p of proposals) {
      log.ok(`${p.kind === "intention" ? "intención" : "respiración"} · ${p.slug}`);
      log.info(p.gap);
      for (const e of p.evidence) log.info(`  ${e.title} — ${e.url}`);
    }
    console.log("");
    log.info("Aplícalas con: npm run curaduria -- --aplicar <slug>");
  }

  log.done("Informe listo.");
}

/* ───────────────────────── investigación ───────────────────────── */

async function investigate(
  report: BalanceReport,
  args: ReturnType<typeof parseArgs>,
  quiet: boolean,
) {
  const intentions = Number(args.values.get("intenciones") ?? 3);
  const exercises = Number(args.values.get("ejercicios") ?? 1);

  // Con --markdown la salida es el informe y nada más: quien la llama la está
  // redirigiendo a un archivo, y el avance va a la salida de error.
  const say = (s: string) => (quiet ? console.error(`  ${s}`) : log.info(s));
  if (quiet) console.error("  investigando…");
  else log.title("Investigando qué falta");

  const proposals = await research(report, {
    intentions,
    exercises,
    onStep: say,
  });

  const fresh: Proposal[] = [];

  for (const proposal of proposals) {
    if (await exists(proposal)) {
      say(`${proposal.slug} — ya existe en el banco, se descarta`);
      continue;
    }

    const { error } = await db()
      .from("omtana_content_proposals")
      .upsert(
        {
          kind: proposal.kind,
          slug: proposal.slug,
          payload: proposal.payload,
          gap: proposal.gap,
          rationale: proposal.rationale,
          evidence: proposal.evidence,
          status: "proposed",
        },
        { onConflict: "kind,slug" },
      );

    if (error) {
      say(`${proposal.slug} — no se pudo guardar: ${error.message}`);
      continue;
    }
    fresh.push(proposal);
  }

  return fresh;
}

/** Una propuesta que ya está en el banco no es una propuesta. */
async function exists(proposal: Proposal): Promise<boolean> {
  const table =
    proposal.kind === "intention" ? "omtana_intentions" : "omtana_breathing_exercises";
  const { data } = await db().from(table).select("id").eq("slug", proposal.slug).maybeSingle();
  return Boolean(data);
}

/* ───────────────────────── aplicar y rechazar ───────────────────────── */

async function listProposals() {
  const rows = await pending();
  if (rows.length === 0) {
    log.done("No hay propuestas pendientes.");
    return;
  }

  log.title(`${rows.length} propuesta${rows.length === 1 ? "" : "s"} pendiente(s)`);
  for (const row of rows) {
    log.step(`${row.kind === "intention" ? "intención" : "respiración"} · ${row.slug}`);
    log.info(row.gap);
    log.info(row.rationale.split("\n")[0]);
    for (const e of row.evidence ?? []) log.info(`  ${e.title} — ${e.url}`);
  }
  console.log("");
  log.info("Aplicar: npm run curaduria -- --aplicar <slug>");
}

async function pending(): Promise<ProposalRow[]> {
  const { data } = await db()
    .from("omtana_content_proposals")
    .select("*")
    .eq("status", "proposed")
    .order("created_at", { ascending: false });
  return (data as ProposalRow[]) ?? [];
}

/**
 * Mete una propuesta al banco.
 *
 * Una intención queda lista para generar en la corrida siguiente. Un ejercicio
 * de respiración **no**: entra al banco, pero su audio se pregenera aparte y
 * hasta que eso pase ninguna sesión lo va a ofrecer. El aviso lo dice, porque
 * es el paso que se olvida.
 */
async function apply(target: string) {
  const rows = await pending();
  const chosen = target === "todas" ? rows : rows.filter((r) => r.slug === target);

  if (chosen.length === 0) {
    fatal(
      target === "todas"
        ? "No hay propuestas pendientes."
        : `No hay ninguna propuesta pendiente con slug "${target}".`,
    );
  }

  log.title(`Aplicando ${chosen.length}`);

  for (const row of chosen) {
    const table = row.kind === "intention" ? "omtana_intentions" : "omtana_breathing_exercises";
    const payload =
      row.kind === "intention"
        ? { ...row.payload, active: true, sort: 500 }
        : { ...row.payload, active: true, sort: 500 };

    const { error } = await db().from(table).upsert(payload, { onConflict: "slug" });
    if (error) {
      log.fail(`${row.slug} — ${error.message}`);
      continue;
    }

    await db()
      .from("omtana_content_proposals")
      .update({ status: "applied", applied_at: new Date().toISOString() })
      .eq("id", row.id);

    log.ok(`${row.slug} → ${table}`);
    if (row.kind === "breathing") {
      log.warn(
        `"${row.slug}" todavía no suena: grábalo con ` +
          `npm run respiracion -- --voz todas --ejercicio ${row.slug}`,
      );
    }
  }

  log.done("Listo.");
}

async function reject(slug: string) {
  const { error, count } = await db()
    .from("omtana_content_proposals")
    .update({ status: "rejected" }, { count: "exact" })
    .eq("slug", slug)
    .eq("status", "proposed");

  if (error) fatal(error.message);
  if (!count) fatal(`No hay ninguna propuesta pendiente con slug "${slug}".`);
  log.done(`Rechazada: ${slug}`);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
