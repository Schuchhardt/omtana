/**
 * Lo que publican los dos servidores MCP, cargados como en producción.
 *
 * Los servidores importan módulos "server-only", así que se cargan en otro
 * proceso con `--conditions=react-server` (como los scripts del CLI) y sin
 * credenciales de Supabase: publicar la lista de herramientas no puede
 * depender de la base.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

interface Described {
  name: string;
  instructions: string;
  tools: {
    name: string;
    description: string;
    inputSchema: { type: string; properties: Record<string, { enum?: unknown[] }>; required?: string[] };
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  }[];
}

let servers: { user: Described; admin: Described };

before(() => {
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const out = execFileSync(
    join(ROOT, "node_modules", ".bin", "tsx"),
    ["--conditions=react-server", join(ROOT, "tests", "helpers", "describe-servers.mts")],
    { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 },
  );
  servers = JSON.parse(out);
});

const names = (s: Described) => s.tools.map((t) => t.name);

describe("servidores MCP", () => {
  test("el de personas crea de las tres formas y devuelve el link", () => {
    for (const name of [
      "get_account",
      "list_options",
      "create_meditation",
      "create_meditation_from_script",
      "generate_from_prompt",
      "get_meditation",
      "list_my_meditations",
    ]) {
      assert.ok(names(servers.user).includes(name), `falta ${name}`);
    }
    assert.match(servers.user.instructions, /player_url/);
  });

  test("el de admin tiene lo de las personas más arquitectura, logs, errores, trazas y costos", () => {
    const admin = names(servers.admin);
    for (const name of ["create_meditation", "create_meditation_from_script", "generate_from_prompt", "get_meditation", "list_options"]) {
      assert.ok(admin.includes(name), `falta ${name} en admin`);
    }
    for (const name of ["get_overview", "get_architecture", "list_logs", "list_errors", "get_meditation_trace", "get_costs", "check_generation_health"]) {
      assert.ok(admin.includes(name), `falta ${name}`);
    }
  });

  test("cada herramienta tiene nombre único, descripción y un esquema de objeto", () => {
    for (const server of [servers.user, servers.admin]) {
      assert.equal(new Set(names(server)).size, server.tools.length, `${server.name}: nombres repetidos`);
      for (const tool of server.tools) {
        assert.match(tool.name, /^[a-z][a-z0-9_]{2,63}$/);
        assert.ok(tool.description.length > 20, `${tool.name}: descripción muy corta`);
        assert.equal(tool.inputSchema.type, "object", `${tool.name}: el esquema no es un objeto`);
        assert.equal("$schema" in tool.inputSchema, false);
      }
    }
  });

  test("los esquemas de creación piden lo justo y enumeran duraciones", () => {
    const script = servers.user.tools.find((t) => t.name === "create_meditation_from_script")!;
    assert.deepEqual(script.inputSchema.required, ["script"]);
    const params = servers.user.tools.find((t) => t.name === "create_meditation")!;
    assert.deepEqual(params.inputSchema.properties.duration_minutes.enum, [5, 10, 15, 20]);
    const prompt = servers.user.tools.find((t) => t.name === "generate_from_prompt")!;
    assert.deepEqual(prompt.inputSchema.required, ["prompt"]);
    assert.ok(prompt.inputSchema.properties.dry_run);
  });

  test("las de solo lectura lo declaran; revocar una llave se marca destructiva", () => {
    for (const name of ["get_account", "list_options", "get_meditation", "list_my_meditations"]) {
      assert.equal(servers.user.tools.find((t) => t.name === name)?.annotations?.readOnlyHint, true, name);
    }
    for (const name of ["get_costs", "list_logs", "get_architecture"]) {
      assert.equal(servers.admin.tools.find((t) => t.name === name)?.annotations?.readOnlyHint, true, name);
    }
    assert.equal(servers.admin.tools.find((t) => t.name === "revoke_api_key")?.annotations?.destructiveHint, true);
  });

  test("crear como admin admite for_user y no cobra por defecto", () => {
    const create = servers.admin.tools.find((t) => t.name === "create_meditation")!;
    assert.ok(create.inputSchema.properties.for_user);
    assert.ok(create.inputSchema.properties.charge);
  });
});
