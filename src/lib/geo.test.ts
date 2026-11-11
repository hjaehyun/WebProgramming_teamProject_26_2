import assert from "node:assert/strict";
import { test } from "node:test";
import { afterPending, roundCoord } from "./geo.ts";

test("roundCoord: 2 decimals (~1 km), never more precise", () => {
  assert.equal(roundCoord(37.56654), 37.57);
  assert.equal(roundCoord(126.97796), 126.98);
  assert.equal(roundCoord(-33.8688), -33.87);
  assert.equal(roundCoord(37.5), 37.5);
});

test("afterPending: an edit/delete waits for the add of the same fragment", async () => {
  const pending = new Map<string, Promise<unknown>>();
  const order: string[] = [];
  let finishAdd!: () => void;
  pending.set("e1", new Promise<void>((r) => (finishAdd = r)).then(() => order.push("add")));
  const del = afterPending(pending, "e1", async () => {
    order.push("delete");
  });
  await Promise.resolve();
  assert.deepEqual(order, []); // delete has not run yet
  finishAdd();
  await del;
  assert.deepEqual(order, ["add", "delete"]);
});

test("afterPending: a failed add still lets the delete run; unknown ids run at once", async () => {
  const pending = new Map<string, Promise<unknown>>([["e1", Promise.reject(new Error("x"))]]);
  let ran = 0;
  await afterPending(pending, "e1", async () => void ran++);
  await afterPending(pending, "e2", async () => void ran++);
  assert.equal(ran, 2);
});
