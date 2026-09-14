import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};

/**
 * Hash del build. Cada plataforma expone el commit con otro nombre, y en local
 * no hay ninguno: ahí lo pregunta a git. El `dev` final es para el caso en que
 * se compile desde un tarball sin repo, que no debería pasar pero tampoco
 * tiene por qué romper el build.
 *
 * Se recorta a 7 caracteres porque es lo que se muestra en el pie del sitio.
 */
function resolveBuildId(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_BUILD_ID ||
    process.env.COMMIT_REF || // Netlify
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);

  try {
    return execSync("git rev-parse --short=7 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  /**
   * Se inyectan al compilar (ver `src/lib/version.ts`). Van por `env` y no por
   * `.env` porque el valor se calcula acá: no hay dónde escribirlo antes.
   */
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_ID: resolveBuildId(),
  },

  async headers() {
    return [
      {
        /**
         * El worker se genera estático, así que sin esto el CDN lo serviría
         * cacheado y un deploy nuevo podría tardar en llegar. `no-cache` no es
         * "no guardar": el navegador lo guarda pero revalida siempre, que es
         * justo lo que hace falta para que la comprobación de versión sea
         * barata y aun así nunca devuelva un worker viejo.
         */
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
