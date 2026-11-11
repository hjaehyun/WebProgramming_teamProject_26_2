const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function weekdayName(key: string): string {
  return WEEKDAYS[fromKey(key).getDay()];
}

/** "10월 26일" */
export function monthDay(key: string): string {
  const d = fromKey(key);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** "10월 26일 (월)" */
export function longDate(key: string): string {
  return `${monthDay(key)} (${weekdayName(key)})`;
}

/** { am: true, label: "9:12" } */
export function clock(iso: string): { am: boolean; label: string } {
  const d = new Date(iso);
  const h = d.getHours();
  return { am: h < 12, label: `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}` };
}

export const WEEKDAY_NAMES = WEEKDAYS;
