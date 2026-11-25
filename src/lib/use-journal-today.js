"use client";

import { useEffect, useState } from "react";
import { todayKey } from "./date";
import { shiftJournalDay } from "./journal-calendar";

// Keep an open calendar current across Seoul midnight and a suspended browser tab.
export function useJournalToday() {
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    let timer;
    const refresh = () => {
      const day = todayKey();
      setToday(day);
      clearTimeout(timer);
      const next = shiftJournalDay(day, 1);
      if (next) timer = setTimeout(refresh, Math.max(1000, new Date(`${next}T00:00:00+09:00`).getTime() - Date.now() + 250));
    };
    const visible = () => { if (!document.hidden) refresh(); };
    timer = setTimeout(refresh, 0);
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return today;
}
