import assert from "node:assert/strict";
import { assessWorker, type RunLite } from "./worker-health";

const now = new Date("2026-10-13T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const run = (id: number, startedMinAgo: number, extra: Partial<RunLite> = {}): RunLite => ({
  id,
  startedAt: ago(startedMinAgo),
  finishedAt: ago(startedMinAgo - 1),
  filesNew: 0,
  filesFailed: 0,
  error: null,
  ...extra,
});
const none = { count: 0, oldest: null };

assert.equal(assessWorker([run(3, 5), run(2, 20)], none, now).level, "ok");
assert.equal(assessWorker([], none, now).level, "warn");

// Una sola pasada fallida no alarma; dos seguidas sí
assert.equal(assessWorker([run(3, 5, { error: "sin acceso a Drive" }), run(2, 20)], none, now).level, "ok");
const two = assessWorker([run(3, 5, { error: "sin acceso a Drive" }), run(2, 20, { error: "x" })], none, now);
assert.equal(two.level, "error");
assert.match(two.messages[0], /dos últimas pasadas.*sin acceso a Drive/);

// La pasada en curso no cuenta: se mira la anterior
const running = run(4, 1, { finishedAt: null });
assert.equal(assessWorker([running, run(3, 15, { error: "a" }), run(2, 30)], none, now).level, "ok");
assert.equal(assessWorker([running, run(3, 15, { error: "a" }), run(2, 30, { error: "b" })], none, now).level, "error");

// Colgada, o todos los archivos fallaron
assert.equal(assessWorker([run(3, 25, { finishedAt: null }), run(2, 40, { filesFailed: 2 })], none, now).level, "error");

// Sin pasadas recientes
assert.match(assessWorker([run(3, 60)], none, now).messages[0], /dejó de revisar/);

// Lecturas atascadas
const stuck = assessWorker([run(3, 5), run(2, 20)], { count: 3, oldest: ago(90) }, now);
assert.equal(stuck.level, "warn");
assert.match(stuck.messages[0], /3 screenshot/);
assert.equal(assessWorker([run(3, 5)], { count: 3, oldest: ago(20) }, now).level, "ok");

console.log("[worker-health.test] OK: aviso de fallas del worker");
