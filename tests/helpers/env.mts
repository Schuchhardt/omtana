/** Un `process.env` a medida para pasarle a las funciones que lo reciben. */
export const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
