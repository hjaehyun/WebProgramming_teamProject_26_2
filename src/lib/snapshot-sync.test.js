import assert from "node:assert/strict";
import { test } from "node:test";
import { createSnapshotSync } from "./snapshot-sync.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test("a refresh begun before an optimistic entry cannot erase the pending entry", async () => {
  const sync = createSnapshotSync();
  const oldResponse = deferred();
  const saved = { drafts: ["new-entry"] };
  let calls = 0;
  let state = { drafts: [] };
  const reading = sync.read(() => ++calls === 1 ? oldResponse.promise : saved, next => { state = next; });
  await turn();
  const finishWrite = sync.beginWrite();
  sync.changed();
  state = { drafts: ["optimistic-entry"] };
  oldResponse.resolve({ drafts: [] });
  await turn();
  assert.deepEqual(state, { drafts: ["optimistic-entry"] });
  assert.equal(calls, 1);
  finishWrite();
  assert.deepEqual(await reading, saved);
  assert.deepEqual(state, saved);
  assert.equal(calls, 2);
});

test("a refresh requested during entry writes waits until every write is finished", async () => {
  const sync = createSnapshotSync();
  const finishAdd = sync.beginWrite();
  const finishEdit = sync.beginWrite();
  let calls = 0;
  const reading = sync.read(async () => { calls++; return "saved"; }, () => {});
  await turn(); assert.equal(calls, 0);
  finishAdd(); await turn(); assert.equal(calls, 0);
  finishEdit();
  assert.equal(await reading, "saved");
  assert.equal(calls, 1);
});

test("a dashboard GET cannot roll a completed generation back to queued", async () => {
  const sync = createSnapshotSync();
  const oldResponse = deferred();
  let calls = 0;
  let shown = "processing";
  const accepted = [];
  const reading = sync.read(() => ++calls === 1 ? oldResponse.promise : { status: "ready" }, next => { shown = next.status; accepted.push(shown); });
  await turn();
  sync.changed(); shown = "ready";
  oldResponse.resolve({ status: "queued" });
  await reading;
  assert.equal(shown, "ready");
  assert.deepEqual(accepted, ["ready"]);
  assert.equal(calls, 2);
});

test("visibility, polling and explicit refresh share the same GET", async () => {
  const sync = createSnapshotSync();
  const response = deferred();
  let calls = 0;
  const first = sync.read(() => { calls++; return response.promise; }, () => {});
  const second = sync.read(() => { calls++; return "wrong"; }, () => {});
  await turn(); assert.equal(calls, 1);
  response.resolve("current");
  assert.deepEqual(await Promise.all([first, second]), ["current", "current"]);
  assert.equal(calls, 1);
});

test("an obsolete read error is retried after a write rather than hiding valid local state", async () => {
  const sync = createSnapshotSync();
  const oldResponse = deferred();
  let calls = 0;
  const reading = sync.read(() => ++calls === 1 ? oldResponse.promise : "saved", () => {});
  await turn();
  const finish = sync.beginWrite();
  finish();
  oldResponse.reject(new Error("stale connection error"));
  assert.equal(await reading, "saved");
  assert.equal(calls, 2);
});

test("failed reads do not permanently block a later refresh", async () => {
  const sync = createSnapshotSync();
  await assert.rejects(sync.read(async () => { throw new Error("offline"); }, () => {}), /offline/);
  assert.equal(await sync.read(async () => "online", () => {}), "online");
});
