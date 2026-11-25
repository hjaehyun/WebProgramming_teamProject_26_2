import { describe, expect, test } from "vitest";
import { addDays, fromKey, toKey } from "../src/lib/date";
import { buildJournalMonth, journalMonth, journalMonthStats, shiftJournalDay, shiftJournalMonth, validJournalDate } from "../src/lib/journal-calendar";

const today = "2026-11-25";
const empty = { artworks: {}, drafts: {} };

describe("calendar access to unpictured journal days", () => {
  test("keeps an old selected month without using the first picture as a lower limit", () => {
    expect(journalMonth("1982-03", today)).toBe("1982-03");
    expect(shiftJournalMonth("1982-01", -1)).toBe("1981-12");
    expect(journalMonth("2026-12", today)).toBe("2026-11");
    expect(journalMonth("2026-99", today)).toBe("2026-11");
  });

  test("rejects malformed calendar dates and safely stops at the supported year boundaries", () => {
    for (const value of ["2026-02-29", "2026-11-31", "2026-1-1", "0000-01-01", "10000-01-01", "not-a-date", null]) expect(validJournalDate(value)).toBe(false);
    expect(validJournalDate("2024-02-29")).toBe(true);
    expect(validJournalDate("0001-01-01")).toBe(true);
    expect(shiftJournalMonth("0001-01", -1)).toBeNull();
    expect(shiftJournalMonth("9999-12", 1)).toBeNull();
    expect(shiftJournalDay("0001-01-01", -1)).toBeNull();
    expect(shiftJournalDay("9999-12-31", 1)).toBeNull();
  });

  test("moves by actual calendar days including leap day and years below 100", () => {
    expect(shiftJournalDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftJournalDay("0099-12-31", 1)).toBe("0100-01-01");
    expect(toKey(fromKey("0099-12-31"))).toBe("0099-12-31");
    expect(addDays("0099-12-31", 1)).toBe("0100-01-01");
    expect(buildJournalMonth(empty, "0099-02", today).filter(cell => cell.kind !== "blank")).toHaveLength(28);
  });

  test("distinguishes past drafts, empty days, today and future without using a sample image", () => {
    const db = { artworks: {}, drafts: { "2026-11-23": [{ id: "one" }, { id: "two" }] } };
    const days = new Map(buildJournalMonth(db, "2026-11", today).map(cell => [cell.key, cell]));
    expect(days.get("2026-11-23")).toMatchObject({ kind: "draft", entryCount: 2 });
    expect(days.get("2026-11-24")).toMatchObject({ kind: "empty", entryCount: 0 });
    expect(days.get(today)?.kind).toBe("today");
    expect(days.get("2026-11-26")?.kind).toBe("future");
  });

  test("counts draft entries as well as pictured entries exactly once", () => {
    const db = {
      artworks: { "2026-11-23": { date: "2026-11-23", entries: [{ id: "one" }] } },
      drafts: { "2026-11-23": [{ id: "stale" }], "2026-11-24": [{ id: "two" }, { id: "three" }], "2026-10-02": [{ id: "outside" }] },
    };
    expect(journalMonthStats(db, "2026-11")).toEqual({ artworkCount: 1, entryCount: 3 });
    expect(buildJournalMonth(db, "2026-11", today).find(cell => cell.key === "2026-11-23")).toMatchObject({ kind: "art", entryCount: 1 });
  });
});
