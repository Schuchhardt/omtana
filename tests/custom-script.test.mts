/**
 * Guiones propios: cómo se parte el texto para la voz y cuánto dura.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAUSE_SECONDS,
  PARAGRAPH_PAUSE_SECONDS,
  estimateScriptSeconds,
  nearestDuration,
  scriptAsPlainText,
  splitScript,
} from "../src/lib/generation/custom-script";

describe("splitScript", () => {
  test("[pausa N] corta el bloque y deja N segundos", () => {
    const blocks = splitScript("Cierra los ojos. [pausa 10] Siente el peso del cuerpo. [pause 3s] Vuelve.");
    assert.deepEqual(blocks, [
      { text: "Cierra los ojos.", pauseAfter: 10 },
      { text: "Siente el peso del cuerpo.", pauseAfter: 3 },
      { text: "Vuelve.", pauseAfter: 0 },
    ]);
  });

  test("sin número, cinco segundos; acepta silencio y decimales con coma", () => {
    const blocks = splitScript("Uno. [pausa] Dos. [silencio 2,5 segundos] Tres.");
    assert.equal(blocks[0].pauseAfter, DEFAULT_PAUSE_SECONDS);
    assert.equal(blocks[1].pauseAfter, 2.5);
  });

  test("los párrafos se juntan en un bloque mientras quepan", () => {
    const blocks = splitScript("Primer párrafo.\n\nSegundo párrafo.\nque sigue acá.");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "Primer párrafo.\n\nSegundo párrafo. que sigue acá.");
  });

  test("un texto largo se parte en bloques con dos segundos entre párrafos", () => {
    const paragraph = "Respira y suelta. ".repeat(40).trim(); // ~720 caracteres
    const blocks = splitScript([paragraph, paragraph, paragraph, paragraph].join("\n\n"), 1600);
    assert.ok(blocks.length >= 2);
    assert.ok(blocks.every((b) => b.text.length <= 1600));
    assert.equal(blocks[0].pauseAfter, PARAGRAPH_PAUSE_SECONDS);
    assert.equal(blocks.at(-1)?.pauseAfter, 0);
  });

  test("una sola oración larguísima se corta igual, sin pasar el tope", () => {
    const blocks = splitScript("palabra ".repeat(1000), 500);
    assert.ok(blocks.length > 1);
    assert.ok(blocks.every((b) => b.text.length <= 500));
  });

  test("pausas seguidas se suman y una pausa al principio no deja un bloque vacío", () => {
    const blocks = splitScript("[pausa 4] Hola. [pausa 2][pausa 3] Chao.");
    assert.deepEqual(blocks, [
      { text: "Hola.", pauseAfter: 5 },
      { text: "Chao.", pauseAfter: 0 },
    ]);
  });
});

describe("duración", () => {
  test("estima a 115 palabras por minuto más las pausas", () => {
    const words = Array.from({ length: 115 }, () => "calma").join(" ");
    assert.equal(estimateScriptSeconds(`${words} [pausa 30] fin`), Math.round((116 / 115) * 60 + 30));
  });

  test("elige la duración del menú más cercana", () => {
    assert.equal(nearestDuration(200), 5);
    assert.equal(nearestDuration(13 * 60), 15);
    assert.equal(nearestDuration(40 * 60), 20);
  });

  test("en un tramo las pausas se vuelven puntos suspensivos", () => {
    assert.equal(scriptAsPlainText("Hola. [pausa 10]  Chao."), "Hola. ... Chao.");
  });
});
