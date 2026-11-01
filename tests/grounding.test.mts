import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { anchorIn, checkGrounding, significantWords } from "../src/lib/generation/grounding";

describe("anchorIn", () => {
  test("tolera flexiones, mayúsculas y tildes", () => {
    assert.ok(anchorIn("la entrevista", "Piensas en las entrevistas que vienen."));
    assert.ok(anchorIn("nervioso", "Te notas nerviosa antes de hablar."));
    assert.ok(anchorIn("mi mamá", "Ves a tu mama en la cocina."));
    assert.ok(anchorIn("el Lunes", "el lunes a primera hora"));
  });

  test("las palabras cortas se comparan enteras", () => {
    assert.equal(anchorIn("luna", "el lunes a primera hora"), false);
  });

  test("un ancla hecha solo de relleno no cuenta", () => {
    assert.deepEqual(significantWords("para que esto"), []);
    assert.equal(anchorIn("para que esto", "para que esto suene"), false);
  });
});

const GROUNDED =
  "Viniste hoy por la entrevista del lunes, en el banco. Sabes que cuando hablas de ti te pones nervioso... " +
  "Te ves llegando a esa oficina del banco, con la carpeta en la mano... " +
  "Y quizás, por primera vez, la entrevista del lunes no es un examen... es una conversación...";

const METAPHOR_ONLY =
  "Frente a ti hay una puerta de madera clara... La luz de la mañana entra por la ventana... " +
  "Das un paso y el suelo es tibio bajo los pies... Un claro se abre adelante, verde y quieto... " +
  "Te quedas ahí, mirando... Guardas esa luz en la mano...";

describe("checkGrounding", () => {
  const anchors = ["la entrevista del lunes", "el banco", "nervioso al hablar de mí"];

  test("pasa cuando lo de la persona se dice, y desde el comienzo", () => {
    const check = checkGrounding(GROUNDED, anchors, { hasContext: true });
    assert.equal(check.ok, true, check.problems.join("\n"));
    assert.equal(check.spoken.length, 3);
  });

  test("una escena bonita que no nombra nada de lo suyo no pasa", () => {
    const check = checkGrounding(METAPHOR_ONLY, anchors, { hasContext: true });
    assert.equal(check.ok, false);
    assert.match(check.problems.join("\n"), /no se dicen en el tramo/);
    assert.match(check.problems.join("\n"), /comienzo del tramo no dice/);
  });

  test("nombrarlo recién al final no alcanza", () => {
    const late = `${METAPHOR_ONLY} ${METAPHOR_ONLY} ${METAPHOR_ONLY} Y piensas en la entrevista del lunes en el banco, nervioso.`;
    const check = checkGrounding(late, anchors, { hasContext: true });
    assert.equal(check.ok, false);
    assert.match(check.problems.join("\n"), /comienzo del tramo/);
  });

  test("con contexto pide al menos dos anclas; sin contexto, una", () => {
    assert.equal(checkGrounding(GROUNDED, ["la entrevista"], { hasContext: true }).ok, false);
    assert.equal(checkGrounding(GROUNDED, ["la entrevista"], { hasContext: false }).ok, true);
    assert.equal(checkGrounding(GROUNDED, [], { hasContext: false }).ok, false);
  });
});
