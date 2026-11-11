"use client";

import Picture from "@/components/Picture";
import { Screen, TopBar } from "@/components/ui";
import { monthDay } from "@/lib/date";
import { sortedArtworks, useStore } from "@/lib/store";
import s from "./pick.module.css";

export default function PickPage() {
  return (
    <Screen>
      <Pick />
    </Screen>
  );
}

function Pick() {
  const { db, toggleExhibit } = useStore();
  const picked = db.exhibition.dates;

  return (
    <>
      <TopBar title="전시할 그림 고르기" back="/exhibition" />
      <p className={s.hint}>누른 순서대로 전시돼요. {picked.length}점 선택됨</p>
      <main className={`scroll ${s.main}`}>
        <div className={s.grid}>
          {sortedArtworks(db).map((w) => {
            const order = picked.indexOf(w.date);
            const on = order >= 0;
            return (
              <button
                key={w.date}
                className={on ? `${s.item} ${s.on}` : s.item}
                aria-pressed={on}
                aria-label={`${monthDay(w.date)} 그림`}
                onClick={() => toggleExhibit(w.date)}
              >
                <Picture scene={w.scene} imageUrl={w.imageUrl} alt={w.summary} />
                <span className={s.date}>{monthDay(w.date)}</span>
                {on && <span className={s.badge}>{order + 1}</span>}
              </button>
            );
          })}
        </div>
      </main>
    </>
  );
}
