import assert from "node:assert/strict";
import { matchByName, normalizeName, uploaderNameFromFile } from "./names";

assert.equal(normalizeName("  José   Alarcón "), "jose alarcon");
assert.equal(uploaderNameFromFile("IMG_1308 - Ana Pérez.jpeg"), "Ana Pérez");
assert.equal(uploaderNameFromFile("Captura de pantalla (168) - ANA PEREZ.png"), "ANA PEREZ");
assert.equal(uploaderNameFromFile("f94d997d-fc31-497f - x - Luis Gómez.jpeg"), "Luis Gómez");
assert.equal(uploaderNameFromFile("captura.png"), null);

const people = [
  { id: 1, fullName: "Ana Pérez", aliases: [] },
  { id: 2, fullName: "Luis Gómez", aliases: ["Lucho G"] },
  { id: 3, fullName: "Ana Perez", aliases: [] },
];
assert.equal(matchByName("luis gomez", people)?.id, 2);
assert.equal(matchByName("Lucho G", people)?.id, 2, "por alias");
assert.equal(matchByName("ANA PEREZ", people), null, "dos coincidencias: no adivina");
assert.equal(matchByName("Otro", people), null);
console.log("[names.test] OK: nombres del Google Form");
