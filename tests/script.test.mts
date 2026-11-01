/**
 * El guion del tramo personalizado, con un modelo de mentira.
 *
 * El modelo de verdad no se puede llamar en los tests, pero lo que decide si
 * la sesión habla de la persona está de este lado: qué se le pide, qué se le
 * pasa y qué se hace con lo que devuelve.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SYSTEM, buildPrompt, writeScript, type ScriptRequest } from "../src/lib/generation/script";
import { TEMPLATE_SYSTEM, PLAN_VERSION } from "../src/lib/generation/template";
import { HOUSE_STYLE } from "../src/lib/generation/style";
import { SCRIPT_REFUSED } from "../src/lib/generation/errors";
import { planSession } from "../src/lib/session-plan";

const plan = planSession(15, 150);
const dynamic = plan.find((s) => s.kind === "dynamic")!;

const request: ScriptRequest = {
  intention: "Llegar tranquilo a mi entrevista",
  context: "Tengo una entrevista de trabajo el lunes en un banco y me pongo muy nervioso cuando hablo de mí.",
  locale: "es",
  voiceName: "Aurora",
  sections: plan,
  surrounding: {
    before: { label: "Entrada al cuerpo", text: "Esta sesión es para llegar en calma. Estás en una cocina con luz de mañana..." },
    after: { label: "Refuerzo e imágenes", text: "Vuelves a la cocina con luz de mañana..." },
  },
};

const GROUNDED_TEXT =
  "Viniste hoy por la entrevista del lunes, en el banco. Sabes que cuando hablas de ti te pones nervioso... " +
  "Desde la cocina con luz de mañana te ves llegando a esa oficina del banco... " +
  "¿Quién eres tú entrando a la entrevista del lunes?... Te ves tranquilo, hablando de ti...";

const METAPHOR_TEXT =
  "Frente a ti hay una puerta de madera clara... La luz de la mañana entra por la ventana... " +
  "Das un paso y el suelo es tibio... Un claro se abre adelante, verde y quieto...";

function reply(text: string, anchors = ["la entrevista del lunes", "el banco", "nervioso"]) {
  return {
    stop_reason: "end_turn" as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          anchors,
          title: "Tranquilo en la entrevista",
          segments: [{ position: dynamic.position, text }],
          keywords: ["entrevista", "banco", "cocina", "luz"],
        }),
        citations: null,
      },
    ],
  };
}

function fakeModel(...texts: string[]) {
  const prompts: string[] = [];
  const create = async (params: { messages: { content: unknown }[] }) => {
    prompts.push(String(params.messages[0].content));
    const next = texts[Math.min(prompts.length - 1, texts.length - 1)];
    return reply(next) as never;
  };
  return { prompts, create };
}

describe("lo que se le pide al modelo", () => {
  test("el tramo tiene que nombrar lo de la persona, no volverlo metáfora", () => {
    assert.doesNotMatch(SYSTEM, /lo vuelves lugar/, "esta instrucción hacía que nunca se nombrara lo suyo");
    assert.match(SYSTEM, /primeras dos o tres frases nombran para qué vino/);
    assert.match(SYSTEM, /nunca la reemplazan por una metáfora/);
    assert.match(HOUSE_STYLE, /Lo que la persona pidió se nombra/);
  });

  test("lleva lo que pidió, lo que contó y lo que suena alrededor", () => {
    const prompt = buildPrompt(request);
    assert.ok(prompt.includes(request.intention));
    assert.ok(prompt.includes(request.context));
    assert.match(prompt, /justo antes de tu tramo \(bloque "Entrada al cuerpo"/);
    assert.ok(prompt.includes("Esta sesión es para llegar en calma."));
    assert.match(prompt, /justo después de tu tramo \(bloque "Refuerzo e imágenes"/);
  });

  test("sin contexto, se escribe sobre lo que pidió", () => {
    const prompt = buildPrompt({ ...request, context: "  " });
    assert.match(prompt, /no contó nada más/);
  });

  test("la plantilla nombra la intención, y es una versión nueva", () => {
    assert.match(TEMPLATE_SYSTEM, /abre nombrando para qué es esta sesión/);
    assert.match(TEMPLATE_SYSTEM, /Vuelve a nombrar la intención/);
    // Las plantillas de la 4 no la nombraban: no se pueden reutilizar.
    assert.ok(PLAN_VERSION >= 5);
  });
});

describe("writeScript", () => {
  test("si nombra lo suyo, con un intento alcanza", async () => {
    const model = fakeModel(GROUNDED_TEXT);
    const result = await writeScript(request, { create: model.create as never });
    assert.equal(model.prompts.length, 1);
    assert.equal(result.grounding.ok, true);
    assert.equal(result.attempts, 1);
    assert.equal(result.segments[dynamic.position], GROUNDED_TEXT);
  });

  test("si escribe una escena que no habla de la persona, la reescribe diciéndole qué faltó", async () => {
    const model = fakeModel(METAPHOR_TEXT, GROUNDED_TEXT);
    const result = await writeScript(request, { create: model.create as never });
    assert.equal(model.prompts.length, 2);
    assert.match(model.prompts[1], /no hablaba de lo que la persona pidió/);
    assert.match(model.prompts[1], /"la entrevista del lunes"/);
    assert.equal(result.grounding.ok, true);
    assert.equal(result.attempts, 2);
  });

  test("si sigue sin hacerlo, entrega igual pero lo marca para avisar", async () => {
    const model = fakeModel(METAPHOR_TEXT, METAPHOR_TEXT);
    const result = await writeScript(request, { create: model.create as never });
    assert.equal(model.prompts.length, 2);
    assert.equal(result.grounding.ok, false);
    assert.ok(result.grounding.problems.length > 0);
  });

  test("un rechazo del modelo sale con el mensaje que ve la persona", async () => {
    const create = async () => ({ stop_reason: "refusal", content: [] }) as never;
    await assert.rejects(writeScript(request, { create }), new RegExp(SCRIPT_REFUSED.slice(0, 30)));
  });
});
