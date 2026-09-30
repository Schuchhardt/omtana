"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, localePath, normalizeLang } from "./i18n";
import { currentPublicHref } from "./lang";

/** Guarda el idioma elegido en el selector de la cabecera. */
export async function setLang(formData: FormData) {
  const next = normalizeLang(formData.get("lang")?.toString());
  if (!next) return;

  const store = await cookies();
  store.set(LANG_COOKIE, next, {
    path: "/",
    maxAge: LANG_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  // La copia se arma en el servidor, así que hay que volver a pintar el árbol
  // entero: la cabecera y el pie viven en el layout.
  revalidatePath("/", "layout");

  // En una página pública el idioma está en la URL: cambiarlo es ir a la otra
  // dirección, con la misma query.
  const publicHref = await currentPublicHref();
  if (publicHref) redirect(localePath(next, publicHref));
}
