// Calendar navigation supports every four-digit positive year accepted by the date API.
// UTC calendar arithmetic avoids browser timezone and years 0–99 constructor quirks.
export function validJournalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === "0000") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validJournalMonth(value) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) && validJournalDate(`${value}-01`);
}

export function journalMonth(raw, today) {
  return validJournalMonth(raw) && raw <= today.slice(0, 7) ? raw : today.slice(0, 7);
}

export function shiftJournalMonth(month, offset) {
  if (!validJournalMonth(month) || !Number.isInteger(offset)) return null;
  const [year, number] = month.split("-").map(Number);
  const index = (year - 1) * 12 + number - 1 + offset;
  if (index < 0 || index >= 9999 * 12) return null;
  return `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}

export function shiftJournalDay(day, offset) {
  if (!validJournalDate(day) || !Number.isInteger(offset)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}

export function buildJournalMonth(db, month, today) {
  if (!validJournalMonth(month)) return [];
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const cells = Array.from({ length: first.getUTCDay() }, (_, i) => ({ kind: "blank", key: `blank-${i}`, day: 0, entryCount: 0 }));
  for (let day = 1; day <= last.getUTCDate(); day++) {
    const key = `${month}-${String(day).padStart(2, "0")}`;
    const artwork = db.artworks[key];
    const entryCount = (artwork?.entries ?? db.drafts[key] ?? []).length;
    const kind = key > today ? "future" : artwork ? "art" : key === today ? "today" : entryCount ? "draft" : "empty";
    cells.push({ kind, key, day, entryCount });
  }
  return cells;
}

export function journalMonthStats(db, month) {
  const artworks = Object.values(db.artworks).filter(artwork => artwork.date.startsWith(`${month}-`));
  const draftCount = Object.entries(db.drafts).reduce((total, [date, entries]) =>
    total + (date.startsWith(`${month}-`) && !db.artworks[date] ? entries.length : 0), 0);
  return { artworkCount: artworks.length, entryCount: artworks.reduce((total, artwork) => total + artwork.entries.length, draftCount) };
}
