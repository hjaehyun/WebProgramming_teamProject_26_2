import assert from "node:assert/strict";
import { test } from "node:test";
import { shareInflight } from "./inflight.js";

test("concurrent calls for the same key share one request", async () => {
  const pending = new Map();
  let calls = 0;
  let release;
  const fn = () => {
    calls++;
    return new Promise((r) => (release = r));
  };
  const a = shareInflight(pending, "2026-11-08", fn);
  const b = shareInflight(pending, "2026-11-08", fn);
  release(7);
  assert.deepEqual(await Promise.all([a, b]), [7, 7]);
  assert.equal(calls, 1);
});

test("other keys run separately, and a finished key can run again", async () => {
  const pending = new Map();
  let calls = 0;
  const fn = async () => `r${++calls}`;
  assert.deepEqual(await Promise.all([shareInflight(pending, "a", fn), shareInflight(pending, "b", fn)]), ["r1", "r2"]);
  assert.equal(await shareInflight(pending, "a", fn), "r3");
  assert.equal(pending.size, 0);
});

test("a failed request is cleared so the next call retries", async () => {
  const pending = new Map();
  await assert.rejects(shareInflight(pending, "a", async () => Promise.reject(new Error("x"))));
  assert.equal(await shareInflight(pending, "a", async () => 1), 1);
});
