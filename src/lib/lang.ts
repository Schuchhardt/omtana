import "server-only";
import { cookies, headers } from "next/headers";
import { LANG_COOKIE, normalizeLang, type UiLang } from "./i18n";
import { LANG_HEADER, PATH_HEADER, isPublicPath } from "./i18n/routes";
import { currentUser } from "./auth";

/**
 * Idioma de interfaz de esta petición.
 *
 * En las páginas públicas manda la URL (`/en/...`): `proxy.ts` deja el idioma
 * en una cabecera. Así Google y los motores de respuesta ven cada versión en
 * su propia dirección, y quien llega a `/en` desde un buscador lee inglés
 * aunque su cookie diga otra cosa.
 *
 * En el resto manda la cookie que escribe el selector de la cabecera. Después va el idioma
 * guardado en el perfil, para que quien lo eligió ahí lo vea desde cualquier
 * navegador. Si todavía no hay elección se mira el `Accept-Language`, y el
 * resto cae en español, que es el idioma de origen del producto.
 *
 * El perfil admite portugués porque es un idioma de meditación válido; la
 * interfaz todavía no, así que ese caso cae en español.
 */
export async function getLang(): Promise<UiLang> {
  const fromUrl = normalizeLang((await headers()).get(LANG_HEADER));
  if (fromUrl) return fromUrl;

  const store = await cookies();
  const chosen = normalizeLang(store.get(LANG_COOKIE)?.value);
  if (chosen) return chosen;

  const user = await currentUser();
  const fromProfile = normalizeLang(user?.locale);
  if (fromProfile) return fromProfile;

  const accept = (await headers()).get("accept-language") ?? "";
  // Basta con el primer idioma declarado: si el navegador pide inglés antes que
  // español, mostramos inglés.
  const first = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return first === "en" ? "en" : "es";
}

/**
 * Ruta interna (con su query) de la página pública que se está pintando, o
 * `null` en las páginas de la cuenta. La pone `proxy.ts`; en una acción de
 * servidor es la página desde la que se envió el formulario.
 */
export async function currentPublicHref(): Promise<string | null> {
  const href = (await headers()).get(PATH_HEADER);
  return href && isPublicPath(href.split("?")[0]) ? href : null;
}
