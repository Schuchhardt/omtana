import { handleAuthServerMetadata } from "@/lib/oauth/handlers";
import { preflight } from "@/lib/oauth/http";

/** Metadata del servidor de autorización (RFC 8414). */
export const GET = handleAuthServerMetadata;
export const OPTIONS = preflight;
