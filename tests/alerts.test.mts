import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { alertChannels, formatAlert, notifyAdmin } from "../src/lib/alerts";
import { env } from "./helpers/env.mjs";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string) => Response | Promise<Response> = () => new Response("ok")) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url));
  }) as typeof fetch;
  return { calls, impl };
}

const quiet = () => {};

const alert = {
  title: "Falló la generación de una meditación",
  detail: "No hay ffmpeg en este entorno.",
  fields: { meditación: "med-1", paso: "mezcla", vacío: "", nulo: null },
};

describe("formatAlert", () => {
  test("lleva título, campos con valor, despliegue y detalle", () => {
    const text = formatAlert(alert, env({ URL: "https://omtana.com", CONTEXT: "production" }));
    assert.match(text, /^🔴 Omtana · Falló la generación/);
    assert.match(text, /• meditación: med-1/);
    assert.match(text, /• paso: mezcla/);
    assert.match(text, /• despliegue: https:\/\/omtana\.com · production/);
    assert.match(text, /No hay ffmpeg en este entorno\./);
    assert.doesNotMatch(text, /vacío|nulo/);
  });

  test("corta lo que no entra en un mensaje de Discord", () => {
    const text = formatAlert({ title: "x", detail: "a".repeat(5_000) }, env({}));
    assert.ok(text.length <= 1_900);
    assert.ok(text.endsWith("…"));
  });
});

describe("notifyAdmin", () => {
  test("sin canales queda solo en el log y no llama a nada", async () => {
    const { calls, impl } = fakeFetch();
    const logged: unknown[][] = [];
    const result = await notifyAdmin(alert, {
      env: env({}),
      fetch: impl,
      log: (...args) => logged.push(args),
    });
    assert.deepEqual(result, { delivered: [], failed: [] });
    assert.equal(calls.length, 0);
    assert.match(String(logged[0][0]), /^\[omtana:alerta\] /);
  });

  test("manda el webhook con text (Slack) y content (Discord)", async () => {
    const { calls, impl } = fakeFetch();
    const result = await notifyAdmin(alert, {
      env: env({ ALERT_WEBHOOK_URL: "https://hooks.slack.test/abc" }),
      fetch: impl,
      log: quiet,
    });
    assert.deepEqual(result.delivered, ["webhook"]);
    assert.equal(calls[0].url, "https://hooks.slack.test/abc");
    const body = JSON.parse(String(calls[0].init.body));
    assert.match(body.text, /Falló la generación/);
    assert.equal(body.content, body.text);
  });

  test("varios webhooks y correo por Resend", async () => {
    const { calls, impl } = fakeFetch();
    const result = await notifyAdmin(alert, {
      env: env({
        ALERT_WEBHOOK_URL: "https://a.test/1, https://b.test/2",
        RESEND_API_KEY: "re_123",
        ALERT_EMAIL_TO: "seba@example.com, otro@example.com",
        ALERT_EMAIL_FROM: "Omtana <alertas@omtana.com>",
      }),
      fetch: impl,
      log: quiet,
    });
    assert.deepEqual(result.delivered.sort(), ["email", "webhook#1", "webhook#2"]);
    const email = calls.find((c) => c.url === "https://api.resend.com/emails")!;
    assert.equal((email.init.headers as Record<string, string>).authorization, "Bearer re_123");
    const body = JSON.parse(String(email.init.body));
    assert.deepEqual(body.to, ["seba@example.com", "otro@example.com"]);
    assert.equal(body.from, "Omtana <alertas@omtana.com>");
    assert.match(body.subject, /^\[Omtana\] Falló la generación/);
  });

  test("un canal caído no tapa a los otros ni lanza", async () => {
    const { impl } = fakeFetch((url) => {
      if (url.includes("roto")) return new Response("nope", { status: 500 });
      if (url.includes("red")) throw new Error("ECONNRESET");
      return new Response("ok");
    });
    const result = await notifyAdmin(alert, {
      env: env({ ALERT_WEBHOOK_URL: "https://roto.test,https://red.test,https://bien.test" }),
      fetch: impl,
      log: quiet,
    });
    assert.deepEqual(result.delivered, ["webhook#3"]);
    assert.deepEqual(result.failed, ["webhook#1", "webhook#2"]);
  });

  test("alertChannels dice qué está configurado", () => {
    assert.deepEqual(alertChannels(env({})), []);
    assert.deepEqual(
      alertChannels(env({ ALERT_WEBHOOK_URL: "https://x", RESEND_API_KEY: "k", ALERT_EMAIL_TO: "a@b.c" })),
      ["webhook", "email"],
    );
    // El correo necesita las dos cosas.
    assert.deepEqual(alertChannels(env({ RESEND_API_KEY: "k" })), []);
  });
});
