import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Un cliente de Supabase de mentira que anota cada consulta encadenada
 * (`from("x").update(...).eq(...)`) y contesta lo que diga `respond`.
 *
 * Alcanza para probar qué se escribe y en qué condiciones sin levantar una
 * base: los tests miran las operaciones, no SQL.
 */
export interface Query {
  table: string;
  ops: Array<[string, unknown[]]>;
}

export type Responder = (query: Query) => { data: unknown; error: { message: string } | null };

export function fakeSupabase(respond: Responder) {
  const queries: Query[] = [];

  const client = {
    from(table: string) {
      const query: Query = { table, ops: [] };
      queries.push(query);
      const builder: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              const result = respond(query);
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(result).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              query.ops.push([String(prop), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, queries };
}

/** ¿Esta consulta tiene esta operación con estos argumentos? */
export function has(query: Query, op: string, ...args: unknown[]): boolean {
  return query.ops.some(
    ([name, given]) => name === op && JSON.stringify(given.slice(0, args.length)) === JSON.stringify(args),
  );
}

export function opArgs(query: Query, op: string): unknown[] | undefined {
  return query.ops.find(([name]) => name === op)?.[1];
}
