const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function toKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return toKey(new Date());
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function weekdayName(key) {
  return WEEKDAYS[fromKey(key).getDay()];
}

/** "10월 26일" */
export function monthDay(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** "10월 26일 (월)" */
export function longDate(key) {
  return `${monthDay(key)} (${weekdayName(key)})`;
}

/** { am: true, label: "9:12" } */
export function clock(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  return { am: h < 12, label: `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}` };
}

export const WEEKDAY_NAMES = WEEKDAYS;
