import assert from "node:assert/strict";
import { matchByName, normalizeName, suggestByName, uploaderNameFromFile } from "./names";

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
const roster = [
  { id: 10, fullName: "Josue Callapa", aliases: [] },
  { id: 11, fullName: "Fabrizio Del Pozo", aliases: [] },
  { id: 12, fullName: "Muricio Fabian Reinaga", aliases: [] },
  { id: 13, fullName: "Ramiro Andres Reinaga", aliases: [] },
  { id: 14, fullName: "Ignacio Vasquez", aliases: [] },
];
assert.equal(suggestByName("Josue Callapa Andrade", roster)?.id, 10);
assert.equal(suggestByName("Fabrizzio Del Pozo", roster)?.id, 11, "una letra de más");
assert.equal(suggestByName("Mauricio Fabián Reinaga Lima", roster)?.id, 12);
assert.equal(suggestByName("iggy vas", roster), null, "apodo: no adivina");
assert.equal(suggestByName("Reinaga", roster), null, "una sola palabra no alcanza");
console.log("[names.test] OK: nombres del Google Form");
