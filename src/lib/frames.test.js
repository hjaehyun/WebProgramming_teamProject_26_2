import assert from "node:assert/strict";
import { test } from "node:test";
import { FRAMES, dayWeathers, diaryCells, frameOf } from "./frames.js";

test("the six frames keep their order and names", () => {
  assert.deepEqual(FRAMES.map((f) => f.id), ["basic", "diary", "polaroid", "wood", "tape", "sketch"]);
  assert.deepEqual(FRAMES.map((f) => f.label), ["기본", "그림일기", "폴라로이드", "원목 액자", "마스킹테이프", "스케치북"]);
});

test("frameOf falls back to basic for anything unknown", () => {
  assert.equal(frameOf("wood"), "wood");
  assert.equal(frameOf("gold"), "basic");
  assert.equal(frameOf(undefined), "basic");
  assert.equal(frameOf(null), "basic");
});

test("diaryCells always gives exactly 40 cells, one character each", () => {
  assert.deepEqual(diaryCells(""), Array(40).fill(""));
  const long = "가".repeat(50);
  assert.deepEqual(diaryCells(long), Array(40).fill("가"));
  const mixed = diaryCells("비 와 🌧️ ok");
  assert.equal(mixed.length, 40);
  assert.deepEqual(mixed.slice(0, 8), ["비", "", "와", "", "🌧️", "", "o", "k"]);
  assert.deepEqual(mixed.slice(8), Array(32).fill(""));
  assert.equal(diaryCells("하루", 4).length, 4);
});

test("dayWeathers lists a day's weather in time order, without repeats, at most three", () => {
  const entries = [
    { at: "2026-11-23T06:00:00Z", weather: { weather: "rain", tempC: 4 } },
    { at: "2026-11-23T00:00:00Z", weather: { weather: "clear", tempC: 6 } },
    { at: "2026-11-23T07:00:00Z", weather: { weather: "rain", tempC: 3 } },
    { at: "2026-11-23T08:00:00Z", weather: { weather: "snow", tempC: 0 } },
    { at: "2026-11-23T09:00:00Z", weather: { weather: "cloudy", tempC: 1 } },
    { at: "2026-11-23T10:00:00Z", weather: null },
  ];
  assert.deepEqual(dayWeathers(entries), ["clear", "rain", "snow"]);
  assert.deepEqual(dayWeathers([{ at: "2026-11-23T00:00:00Z", weather: null }]), []);
  assert.deepEqual(dayWeathers([]), []);
});
