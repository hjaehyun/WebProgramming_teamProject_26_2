import { describe, expect, test } from "vitest";
import { dateSchema, entriesChanged, entrySchema, seoulDate, seoulTime, displayDate, frames, styles } from "../src/server/core/domain";
describe("frames and drawing styles", () => {
  test("the six frames, in order, start with basic", () => {
    expect(frames).toEqual(["basic", "diary", "polaroid", "wood", "tape", "sketch"]);
  });
  test("the anime style is described only by its features", () => {
    expect(styles.anime.label).toBe("애니 풍경");
    expect(styles.anime.prompt).toMatch(/hand-painted anime background/i);
    for (const s of Object.values(styles)) expect(s.prompt).not.toMatch(/ghibli|miyazaki|totoro|지브리|미야자키|토토로/i);
  });
});
describe("fragments changed since the picture was drawn", () => {
  const snapshot = [{ content: "산책", created_at: "2026-11-19T01:00:00+00:00" }, { content: "비", created_at: "2026-11-19T02:00:00+00:00" }];
  test("compares the texts only, in any order", () => {
    expect(entriesChanged(snapshot, ["비", "산책"])).toBe(false);
    expect(entriesChanged(snapshot, ["산책"])).toBe(true);
    expect(entriesChanged(snapshot, ["산책", "비", "더한 기록"])).toBe(true);
    expect(entriesChanged(snapshot, ["산책", "눈"])).toBe(true);
    expect(entriesChanged([{ content: "비" }, { content: "비" }], ["비", "산책"])).toBe(true);
  });
  test("a missing or malformed snapshot never claims a change", () => {
    expect(entriesChanged(undefined, ["산책"])).toBe(false);
    expect(entriesChanged(null, [])).toBe(false);
    expect(entriesChanged([], [])).toBe(false);
  });
});
describe("Korea day boundaries and journal validation", () => {
  test("midnight rolls at 15:00 UTC", () => {
    expect(seoulDate(new Date("2026-11-03T14:59:59Z"))).toBe("2026-11-03");
    expect(seoulDate(new Date("2026-11-03T15:00:00Z"))).toBe("2026-11-04");
  });
  test("formats Korean text identically independent of ICU version", () => {
    expect(seoulTime("2026-11-04T00:12:00Z")).toBe("오전 9:12");
    expect(seoulTime("2026-11-04T03:01:00Z")).toBe("오후 12:01");
    expect(displayDate("2026-11-04")).toBe("11월 4일 수요일");
  });
  test("rejects nonexistent dates and empty/oversized notes", () => {
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateSchema.safeParse("2028-02-29").success).toBe(true);
    expect(entrySchema.safeParse({ content: "  " }).success).toBe(false);
    expect(entrySchema.safeParse({ content: "가".repeat(501) }).success).toBe(false);
    expect(entrySchema.parse({ content: " 오늘도 한 조각 " }).content).toBe("오늘도 한 조각");
  });
});
