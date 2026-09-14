import "server-only";
import { cookies, headers } from "next/headers";
import { LANG_COOKIE, normalizeLang, type UiLang } from "./i18n";
import { currentUser } from "./auth";

/**
 * Idioma de interfaz de esta petición.
 *
 * Manda la cookie que escribe el selector de la cabecera. Después va el idioma
 * guardado en el perfil, para que quien lo eligió ahí lo vea desde cualquier
 * navegador. Si todavía no hay elección se mira el `Accept-Language`, y el
 * resto cae en español, que es el idioma de origen del producto.
 *
 * El perfil admite portugués porque es un idioma de meditación válido; la
 * interfaz todavía no, así que ese caso cae en español.
 */
export async function getLang(): Promise<UiLang> {
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
