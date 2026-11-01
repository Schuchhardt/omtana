/**
 * Lo que tiene que seguir escrito para que producción pueda generar.
 *
 * El empaquetado de Netlify no se puede correr acá, así que se cuida lo que lo
 * decide: que las funciones que mezclan audio lleven el binario de ffmpeg, que
 * el paquete no se meta dentro del bundle (rompería su `__dirname`) y que la
 * ruta a la que despacha la app sea una función que existe.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BACKGROUND_FUNCTION_PATH } from "../src/lib/generation/dispatch";

const ROOT = resolve(import.meta.dirname, "..");

/** Lo justo de TOML para netlify.toml: secciones, `clave = "valor"` y listas de strings. */
function parseToml(text: string): Record<string, Record<string, string | string[]>> {
  const sections: Record<string, Record<string, string | string[]>> = {};
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = header[1].replace(/"/g, "");
      sections[current] ??= {};
      continue;
    }
    const pair = line.match(/^([\w.-]+)\s*=\s*(.+)$/);
    if (!pair) continue;
    const value = pair[2].trim();
    sections[current] ??= {};
    sections[current][pair[1]] = value.startsWith("[")
      ? [...value.matchAll(/"([^"]*)"/g)].map((m) => m[1])
      : value.replace(/^"|"$/g, "");
  }
  return sections;
}

const toml = parseToml(readFileSync(join(ROOT, "netlify.toml"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

const MIXES_AUDIO = ["generate-background", "generation-health"];

describe("netlify.toml", () => {
  for (const name of MIXES_AUDIO) {
    test(`${name} lleva el binario de ffmpeg-static`, () => {
      const section = toml[`functions.${name}`];
      assert.ok(section, `falta [functions."${name}"] en netlify.toml`);
      const included = [section.included_files ?? []].flat();
      assert.ok(
        included.some((glob) => glob.startsWith("node_modules/ffmpeg-static")),
        `included_files de ${name} tiene que incluir node_modules/ffmpeg-static`,
      );
      assert.ok([section.external_node_modules ?? []].flat().includes("ffmpeg-static"));
      assert.equal(section.node_bundler, "esbuild");
    });
  }

  test("cada función configurada existe", () => {
    for (const key of Object.keys(toml).filter((k) => k.startsWith("functions."))) {
      const name = key.slice("functions.".length);
      assert.ok(
        existsSync(join(ROOT, "netlify", "functions", `${name}.mts`)),
        `netlify.toml configura "${name}" pero no hay netlify/functions/${name}.mts`,
      );
    }
  });

  test("la app despacha a una función que existe y corre en segundo plano", () => {
    const name = BACKGROUND_FUNCTION_PATH.split("/").at(-1)!;
    const file = join(ROOT, "netlify", "functions", `${name}.mts`);
    assert.ok(existsSync(file));
    assert.match(readFileSync(file, "utf8"), /background:\s*true/);
  });
});

describe("dependencias", () => {
  test("ffmpeg-static es dependencia de producción y trae su binario", () => {
    assert.ok(pkg.dependencies["ffmpeg-static"], "ffmpeg-static tiene que estar en dependencies");
    assert.ok(
      existsSync(join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg")),
      "falta el binario: ¿se instaló con --ignore-scripts? Corre `npm rebuild ffmpeg-static`",
    );
  });

  test("el bundle de Next no carga el binario de 80 MB", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    assert.match(config, /outputFileTracingExcludes[\s\S]*node_modules\/ffmpeg-static/);
  });
});
