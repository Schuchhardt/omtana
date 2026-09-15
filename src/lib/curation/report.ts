/**
 * El informe de curaduría en Markdown.
 *
 * Lo usan la línea de comandos y el resumen de GitHub Actions: es el mismo
 * texto en los dos lados a propósito, porque lo que se lee en el navegador
 * después de una corrida automática tiene que ser lo mismo que se ve al
 * correrlo a mano antes de confiar en ella.
 */
import type { BalanceReport, Gap } from "./balance";
import type { Proposal } from "./research";

export function markdown(report: BalanceReport, proposals: Proposal[] = []): string {
  const out: string[] = [];

  out.push("## Equilibrio del banco", "");
  out.push(
    `${report.totals.intentions} intenciones · ${report.totals.meditations} sesiones públicas · ` +
      `${report.totals.videos} videos · ${report.totals.exercises} ejercicios de respiración`,
    "",
  );
  if (report.totals.retired > 0) {
    out.push(
      `Además hay ${report.totals.retired} sesión(es) pública(s) de intenciones ya retiradas del ` +
        `banco: siguen sonando en el catálogo, pero no cuentan acá porque su área ya no existe.`,
      "",
    );
  }

  out.push("### Por área de la vida", "");
  out.push("| Área | Intenciones | Sesiones | Con video |", "| --- | ---: | ---: | ---: |");
  for (const row of report.areas) {
    out.push(`| ${row.key} | ${row.intentions} | ${row.meditations} | ${row.videos} |`);
  }
  out.push("");

  out.push("### Por necesidad", "");
  out.push("| Necesidad | Intenciones | Sesiones |", "| --- | ---: | ---: |");
  for (const row of report.needs) {
    out.push(`| ${row.key} | ${row.intentions} | ${row.meditations} |`);
  }
  out.push("");

  out.push("### Forma", "");
  out.push(
    `Duraciones: ${report.durations.map((d) => `${d.minutes} min → ${d.meditations}`).join(" · ")}`,
    "",
    `Idiomas: ${report.locales.map((l) => `${l.locale} → ${l.meditations}`).join(" · ") || "—"}`,
    "",
  );

  out.push("### Respiración", "");
  for (const family of report.breathing.families) {
    out.push(
      `- ${family.label}: ${family.exercises.length ? family.exercises.join(", ") : "**sin cubrir**"}`,
    );
  }
  if (report.breathing.unrecorded.length > 0) {
    out.push("", `Sin grabar para todas las voces: ${report.breathing.unrecorded.join(", ")}`);
  }
  out.push("");

  out.push("### Huecos", "");
  if (report.gaps.length === 0) {
    out.push("Ninguno: el banco está parejo.", "");
  } else {
    for (const gap of report.gaps.slice(0, 20)) {
      out.push(`- ${icon(gap)} ${gap.label}`);
    }
    if (report.gaps.length > 20) out.push(`- … y ${report.gaps.length - 20} más`);
    out.push("");
  }

  if (proposals.length > 0) {
    out.push("## Propuestas de la investigación", "");
    out.push(
      "Quedan como `proposed`. Para aplicarlas: `npm run curaduria -- --aplicar <slug>`.",
      "",
    );
    for (const p of proposals) {
      out.push(`### ${p.kind === "intention" ? "Intención" : "Respiración"} · \`${p.slug}\``, "");
      out.push(`**Hueco:** ${p.gap}`, "");
      out.push(p.rationale, "");
      if (p.evidence.length > 0) {
        out.push("**Evidencia:**", "");
        for (const e of p.evidence) out.push(`- [${e.title}](${e.url}) — ${e.finding}`);
        out.push("");
      }
    }
  }

  return out.join("\n");
}

function icon(gap: Gap): string {
  if (gap.kind === "meditation") return "🎧";
  if (gap.kind === "video") return "🎬";
  if (gap.kind === "breathing") return "🫁";
  return "✍️";
}
