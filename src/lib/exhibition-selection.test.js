import assert from "node:assert/strict";
import { test } from "node:test";
import { canChooseExhibitionArtwork, nextExhibitionDates } from "./exhibition-selection.js";

const artworks = {
  first: { date: "first", status: "ready" },
  failed: { date: "failed", status: "failed" },
  queued: { date: "queued", status: "queued" },
  processing: { date: "processing", status: "processing" },
  last: { date: "last", status: "ready" },
};

test("selected failed or pending pictures remain available to take down", () => {
  const selected = ["failed", "queued", "processing"];
  for (const date of selected) {
    assert.equal(canChooseExhibitionArtwork(artworks[date], selected), true);
    assert.equal(canChooseExhibitionArtwork(artworks[date], []), false);
  }
  assert.equal(canChooseExhibitionArtwork(artworks.first, []), true);
});

test("taking down one failed picture clears other unavailable selections in the same valid request", () => {
  const selected = ["first", "failed", "queued", "processing", "last"];
  assert.deepEqual(nextExhibitionDates(selected, artworks, "failed"), ["first", "last"]);
  assert.deepEqual(selected, ["first", "failed", "queued", "processing", "last"]);
});

test("adding a ready picture preserves selection order while clearing unavailable pictures", () => {
  assert.deepEqual(nextExhibitionDates(["first", "failed", "queued"], artworks, "last"), ["first", "last"]);
});

test("ordinary removal preserves other ready selections and empty selection is allowed", () => {
  assert.deepEqual(nextExhibitionDates(["first", "last"], artworks, "first"), ["last"]);
  assert.deepEqual(nextExhibitionDates(["failed", "queued"], artworks, "failed"), []);
});

test("a stale selection handler cannot add a picture that is no longer ready", () => {
  assert.deepEqual(nextExhibitionDates(["first"], artworks, "processing"), ["first"]);
});
