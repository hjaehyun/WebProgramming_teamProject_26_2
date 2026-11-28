import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { TRASH_DAYS, daysLeft, emptyTrash, fetchTrash, purgeTrash, restoreTrash, trashView } from "./trash.js";

test("a failed first load is an error to retry, never an empty trash", () => {
  assert.equal(trashView(null, null), "loading");
  assert.equal(trashView(null, "휴지통을 불러오지 못했어요."), "error");
  assert.equal(trashView([], null), "empty");
  assert.equal(trashView([{ id: "a" }], "다시 불러오지 못했어요."), "list");
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function stubFetch(body, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push([url, init.method ?? "GET"]); return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); };
  return calls;
}

test("days left count whole days up to the purge time, never below zero", () => {
  const now = new Date("2026-11-28T00:00:00Z");
  assert.equal(TRASH_DAYS, 30);
  assert.equal(daysLeft("2026-12-28T00:00:00Z", now), 30);
  assert.equal(daysLeft("2026-11-28T01:00:00Z", now), 1);
  assert.equal(daysLeft("2026-11-27T23:00:00Z", now), 0);
});

test("the trash helpers call the trash API and surface its error message", async () => {
  let calls = stubFetch({ items: [{ id: "a" }] });
  assert.deepEqual(await fetchTrash(), [{ id: "a" }]);
  calls = stubFetch({ ok: true, restored: "entry_only", date: "2026-11-27" });
  assert.deepEqual(await restoreTrash("x 1"), { ok: true, restored: "entry_only", date: "2026-11-27" });
  assert.deepEqual(calls, [["/api/me/trash/x%201/restore", "POST"]]);
  calls = stubFetch({ ok: true });
  await purgeTrash("a"); await emptyTrash();
  assert.deepEqual(calls, [["/api/me/trash/a", "DELETE"], ["/api/me/trash", "DELETE"]]);
  stubFetch({ error: "이날 다른 그림이 있어 이 그림은 되살릴 수 없어요." }, 409);
  await assert.rejects(restoreTrash("a"), /다른 그림/);
});
