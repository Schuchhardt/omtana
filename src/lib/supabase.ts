import "server-only";

/**
 * Punto de entrada de la app al cliente con service role. La marca
 * "server-only" hace que el build falle si un componente de cliente lo importa.
 * El código vive en `./supabase-client`, que el motor de generación importa
 * directo para poder correr también en las funciones de Netlify.
 */
export { db, isConfigured } from "./supabase-client";
