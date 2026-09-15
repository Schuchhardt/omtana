/**
 * Las tandas automáticas, como una sola orden.
 *
 *   npm run ci -- meditaciones        lo que el banco necesita esta semana
 *   npm run ci -- videos              los videos de la semana
 *   npm run ci -- videos --seco       dice qué haría, sin hacerlo
 *
 * GitHub Actions no hace nada distinto de esto: el workflow llama a este mismo
 * comando con los mismos argumentos. Es la única forma de que "probarlo
 * localmente" signifique algo — si acá funciona y allá no, la diferencia está
 * en los secretos o en el runner, no en lo que se ejecuta.
 *
 * Cada paso es un comando que también se puede correr a mano; se imprimen tal
 * cual antes de correrlos, para poder copiar el que falló y repetirlo.
 */
import "./_bootstrap";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { log, parseArgs, fatal } from "./_bootstrap";

interface Step {
  title: string;
  script: string;
  args: string[];
  /** Un paso opcional que falla no tumba la tanda. */
  optional?: boolean;
}

async function main() {
  const args = parseArgs();
  const task = args.positional[0];

  if (task !== "videos" && task !== "meditaciones") {
    fatal(
      "Falta qué tanda correr.\n" +
        "    npm run ci -- meditaciones\n" +
        "    npm run ci -- videos",
    );
  }

  const dry = args.flags.has("seco");
  const steps = task === "videos" ? videoSteps(args) : meditationSteps(args);

  log.title(`Tanda: ${task}${dry ? " (en seco)" : ""}`);

  const missing = requiredEnv(task, args).filter((key) => !process.env[key]);
  if (missing.length > 0) {
    fatal(
      `Faltan variables de entorno: ${missing.join(", ")}.\n` +
        "    En local van en .env.local; en Actions, en los secretos del repo.",
    );
  }

  const results: { title: string; ok: boolean }[] = [];

  for (const step of steps) {
    const command = `npx tsx --conditions=react-server ${step.script} ${step.args.join(" ")}`;
    log.step(step.title);
    log.info(command);

    if (dry) {
      results.push({ title: step.title, ok: true });
      continue;
    }

    const code = await run(step.script, step.args);
    const ok = code === 0;
    results.push({ title: step.title, ok });

    if (!ok && !step.optional) {
      await summary(task, results, "cortada");
      fatal(`"${step.title}" terminó con código ${code}.`);
    }
  }

  await summary(task, results, dry ? "en seco" : "completa");
  log.done(`Tanda ${task} ${dry ? "revisada" : "terminada"}.`);
}

/* ───────────────────────── las tandas ───────────────────────── */

function meditationSteps(args: ReturnType<typeof parseArgs>): Step[] {
  const cuantas = args.values.get("cuantas") ?? "3";
  const voz = args.values.get("voz");
  const idioma = args.values.get("idioma");

  const curaduria = ["--markdown"];
  if (args.flags.has("investigar")) {
    curaduria.push("--investigar");
    if (args.values.has("intenciones")) {
      curaduria.push("--intenciones", args.values.get("intenciones")!);
    }
    if (args.values.has("ejercicios")) {
      curaduria.push("--ejercicios", args.values.get("ejercicios")!);
    }
  }

  const generate = ["--faltantes", cuantas];
  if (voz) generate.push("--voz", voz);
  if (idioma) generate.push("--idioma", idioma);

  return [
    {
      title: args.flags.has("investigar")
        ? "Curaduría: informe e investigación"
        : "Curaduría: informe del banco",
      script: "scripts/curaduria.ts",
      args: curaduria,
    },
    {
      title: `Generar las ${cuantas} sesiones que más falta hacen`,
      script: "scripts/generate.ts",
      args: generate,
    },
  ];
}

function videoSteps(args: ReturnType<typeof parseArgs>): Step[] {
  const cuantos = args.values.get("cuantos") ?? "3";
  const formato = args.values.get("formato") ?? "todos";

  const steps: Step[] = [
    {
      title: `Renderizar ${cuantos} meditación(es) en ${formato}`,
      script: "scripts/video.ts",
      args: ["--semanal", cuantos, "--formato", formato],
    },
  ];

  if (args.flags.has("publicar")) {
    steps.push({
      title: "Subir a YouTube (privado hasta que alguien lo revise)",
      script: "scripts/publish-youtube.ts",
      args: [
        "--cuantos", cuantos,
        "--formato", "youtube",
        "--visibilidad", args.values.get("visibilidad") ?? "private",
      ],
    });
  }

  return steps;
}

function requiredEnv(task: string, args: ReturnType<typeof parseArgs>): string[] {
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

  if (task === "meditaciones") keys.push("ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY");
  if (task === "videos" && args.flags.has("publicar")) {
    keys.push("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN");
  }

  return keys;
}

/* ───────────────────────── plomería ───────────────────────── */

function run(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["tsx", "--conditions=react-server", script, ...args],
      { stdio: "inherit", env: process.env },
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** El resumen del job en Actions: lo que se mira sin abrir los logs. */
async function summary(
  task: string,
  results: { title: string; ok: boolean }[],
  outcome: string,
) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;

  const lines = [
    `## Tanda ${task} — ${outcome}`,
    "",
    ...results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.title}`),
    "",
  ];

  await appendFile(file, `${lines.join("\n")}\n`);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
