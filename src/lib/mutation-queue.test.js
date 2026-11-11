import assert from "node:assert/strict";
import { test } from "node:test";
import { createMutationQueue } from "./mutation-queue.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("closing waits for a delayed add, edit and delete in order", async () => {
  const queue = createMutationQueue();
  const add = deferred();
  const edit = deferred();
  const calls = [];
  queue.enqueue("entry", async () => { calls.push("add"); await add.promise; });
  queue.enqueue("entry", async () => { calls.push("edit"); await edit.promise; });
  queue.enqueue("entry", async () => { calls.push("delete"); });
  let closed = false;
  const closing = queue.flush().then(() => { closed = true; });
  await Promise.resolve();
  assert.deepEqual(calls, ["add"]);
  assert.equal(closed, false);
  add.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["add", "edit"]);
  assert.equal(closed, false);
  edit.resolve();
  await closing;
  assert.deepEqual(calls, ["add", "edit", "delete"]);
  assert.equal(closed, true);
});

test("closing also waits for a write enqueued while it was waiting", async () => {
  const queue = createMutationQueue();
  const first = deferred();
  const second = deferred();
  queue.enqueue("first", () => first.promise);
  let closed = false;
  const closing = queue.flush().then(() => { closed = true; });
  queue.enqueue("second", () => second.promise);
  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  second.resolve();
  await closing;
  assert.equal(closed, true);
});

test("a failed save aborts closing even after the failed request has settled", async () => {
  const queue = createMutationQueue();
  await assert.rejects(queue.enqueue("entry", async () => { throw new Error("offline"); }), /offline/);
  await assert.rejects(queue.flush(), /저장하지 못한 조각/);
  // Only an acknowledged fresh dashboard clears the failure for later closing.
  queue.acknowledgeFailures();
  await queue.flush();
});

test("dependent edits do not run after an add failed; a later successful retry clears its error", async () => {
  const queue = createMutationQueue();
  let edited = false;
  const add = queue.enqueue("entry", async () => { throw new Error("offline"); });
  const edit = queue.enqueue("entry", async () => { edited = true; });
  await Promise.allSettled([add, edit]);
  assert.equal(edited, false);
  await assert.rejects(queue.flush(), /저장하지 못한 조각/);
  await queue.enqueue("entry", async () => { edited = true; });
  await queue.flush();
  assert.equal(edited, true);
});

test("unrelated fragments can save concurrently", async () => {
  const queue = createMutationQueue();
  const first = deferred();
  const calls = [];
  queue.enqueue("first", async () => { calls.push("first"); await first.promise; });
  await queue.enqueue("second", async () => { calls.push("second"); });
  assert.deepEqual(calls, ["first", "second"]);
  first.resolve();
  await queue.flush();
});

test("failed optimistic entries don't permanently block closing after reconciliation", async () => {
  const queue = createMutationQueue();
  await assert.rejects(queue.enqueue("failed-entry", async () => { throw new Error("offline"); }));
  assert.equal(queue.acknowledgeFailures(), true);
  await queue.enqueue("new-entry", async () => {});
  await queue.flush();
});

test("acknowledging a failure cannot hide it from an already waiting close", async () => {
  const queue = createMutationQueue();
  const write = deferred();
  const request = queue.enqueue("entry", () => write.promise);
  request.catch(() => { queue.acknowledgeFailures(); });
  const closing = queue.flush();
  write.reject(new Error("offline"));
  await assert.rejects(closing, /저장하지 못한 조각/);
  await queue.flush();
});

test("reconciliation cannot acknowledge an entry whose write is still pending", async () => {
  const queue = createMutationQueue();
  const write = deferred();
  const request = queue.enqueue("entry", () => write.promise);
  assert.equal(queue.acknowledgeFailures(), false);
  write.resolve(); await request;
  assert.equal(queue.acknowledgeFailures(), true);
});
