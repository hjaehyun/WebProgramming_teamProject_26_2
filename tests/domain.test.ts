import { describe, expect, test } from "vitest";
import { dateSchema, entrySchema, seoulDate, seoulTime, displayDate } from "../src/server/core/domain";
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
