import assert from "node:assert/strict";
import { test } from "node:test";
import { createFrameWrites } from "./frame-writes.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("frame writes for one day run one at a time, in the order chosen", async () => {
  const sent = [];
  const gates = [];
  const writes = createFrameWrites((date, frame) => { sent.push(frame); const d = deferred(); gates.push(d); return d.promise; });
  const all = ["wood", "tape", "diary"].map((f) => writes.write("2026-11-23", f));
  await tick();
  assert.deepEqual(sent, ["wood"]);
  gates[0].resolve();
  await tick();
  assert.deepEqual(sent, ["wood", "tape"]);
  gates[1].resolve();
  await tick();
  gates[2].resolve();
  await Promise.all(all);
  assert.deepEqual(sent, ["wood", "tape", "diary"]);
});

test("different days do not wait for each other", async () => {
  const sent = [];
  const writes = createFrameWrites((date) => { sent.push(date); return new Promise(() => {}); });
  writes.write("2026-11-22", "wood");
  writes.write("2026-11-23", "tape");
  await tick();
  assert.deepEqual(sent, ["2026-11-22", "2026-11-23"]);
});

test("a failed write is reported to its caller and does not block the next choice", async () => {
  const sent = [];
  const writes = createFrameWrites(async (date, frame) => { sent.push(frame); if (frame === "wood") throw new Error("저장 실패"); });
  const first = writes.write("2026-11-23", "wood");
  const second = writes.write("2026-11-23", "tape");
  await assert.rejects(first, /저장 실패/);
  await second;
  assert.deepEqual(sent, ["wood", "tape"]);
});
