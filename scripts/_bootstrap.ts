import { config } from "dotenv";
import { existsSync } from "node:fs";

// Mismo orden que usa Next, para que scripts y app lean lo mismo.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) config({ path: file, quiet: true });
}

export function requireEnv(...keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n  Faltan variables de entorno: ${missing.join(", ")}`);
    console.error("  Copia .env.example a .env.local y complétalas.\n");
    process.exit(1);
  }
}

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split("=");
    if (inline !== undefined) {
      values.set(key, inline);
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      values.set(key, argv[++i]);
    } else {
      flags.add(key);
    }
  }

  return { flags, values, positional };
}

/* Salida legible sin dependencias. */
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const clay = (s: string) => `\x1b[38;5;173m${s}\x1b[0m`;

export const log = {
  title: (s: string) => console.log(`\n${clay("◈")} ${bold(s)}\n`),
  step: (s: string) => console.log(`  ${clay("·")} ${s}`),
  info: (s: string) => console.log(`    ${dim(s)}`),
  ok: (s: string) => console.log(`  ${clay("✓")} ${s}`),
  warn: (s: string) => console.log(`  ${clay("!")} ${s}`),
  fail: (s: string) => console.error(`  \x1b[31m✕\x1b[0m ${s}`),
  done: (s: string) => console.log(`\n${clay("◈")} ${s}\n`),
};

export function fatal(message: string): never {
  log.fail(message);
  process.exit(1);
}
