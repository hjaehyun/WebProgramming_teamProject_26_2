"use client";

import Link from "next/link";
import { useState } from "react";
import Picture from "@/components/Picture";
import { BottomNav, IconBack, IconNext, ProfileButton, Screen } from "@/components/ui";
import { monthDay, toKey, todayKey, WEEKDAY_NAMES } from "@/lib/date";
import { sortedArtworks, useStore } from "@/lib/store";
import type { DB } from "@/lib/types";
import s from "./gallery.module.css";

export default function GalleryPage() {
  return (
    <Screen>
      <Gallery />
    </Screen>
  );
}

type Cell =
  | { kind: "blank"; key: string }
  | { kind: "art" | "empty" | "today" | "future"; key: string; day: number };

function buildMonth(db: DB, year: number, month: number): Cell[] {
  const today = todayKey();
  const lead = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Cell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ kind: "blank", key: `b${i}` });
  for (let d = 1; d <= days; d++) {
    const key = toKey(new Date(year, month, d));
    const kind = db.artworks[key] ? "art" : key === today ? "today" : key > today ? "future" : "empty";
    cells.push({ kind, key, day: d });
  }
  return cells;
}

function Gallery() {
  const { db } = useStore();
  const now = new Date();
  const works = sortedArtworks(db);
  const oldest = works.length ? works[works.length - 1].date : todayKey();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const first = { y: Number(oldest.slice(0, 4)), m: Number(oldest.slice(5, 7)) - 1 };
  const atFirst = ym.y === first.y && ym.m === first.m;
  const atLast = ym.y === now.getFullYear() && ym.m === now.getMonth();
  const shift = (n: number) => setYm(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (m + n + 12) % 12 }));

  const cells = buildMonth(db, ym.y, ym.m);
  const prefix = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
  const monthWorks = works.filter((w) => w.date.startsWith(prefix));
  const fragCount = monthWorks.reduce((n, w) => n + w.entries.length, 0);

  return (
    <>
      <main className={`scroll ${s.main}`}>
        <div className={s.monthHead}>
          <h1 className="hand">
            {ym.y}년 {ym.m + 1}월
          </h1>
          <div className={s.monthNav}>
            <button className="icon-btn" aria-label="이전 달" onClick={() => shift(-1)} disabled={atFirst}>
              <IconBack />
            </button>
            <button className="icon-btn" aria-label="다음 달" onClick={() => shift(1)} disabled={atLast}>
              <IconNext />
            </button>
            <ProfileButton />
          </div>
        </div>
        <div className={s.stats}>
          이번 달 그림 {monthWorks.length}장 · 조각글 {fragCount}개
        </div>

        <div className={s.grid}>
          {WEEKDAY_NAMES.map((w) => (
            <div key={w} className={s.wd}>
              {w}
            </div>
          ))}
          {cells.map((c) => {
            if (c.kind === "blank") return <div key={c.key} className={s.blank} />;
            if (c.kind === "art")
              return (
                <Link key={c.key} href={`/gallery/${c.key}`} className={s.tile} aria-label={`${monthDay(c.key)} 그림 보기`}>
                  <Picture scene={db.artworks[c.key].scene} imageUrl={db.artworks[c.key].imageUrl} alt={db.artworks[c.key].summary} />
                  <span className={s.dnum}>{c.day}</span>
                </Link>
              );
            if (c.kind === "today")
              return (
                <Link key={c.key} href="/today" className={s.today} aria-label="오늘, 아직 그리는 중">
                  <span className={s.todayNum}>{c.day}</span>
                  <span>오늘</span>
                </Link>
              );
            return (
              <div key={c.key} className={c.kind === "empty" ? s.empty : s.future}>
                <span>{c.day}</span>
              </div>
            );
          })}
        </div>

        <Link href="/curator" className={s.curator}>
          <span className={s.curatorIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" />
              <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
            </svg>
          </span>
          <span className={s.curatorText}>
            <span>AI 큐레이터</span>
            <strong>{ym.m + 1}월의 그림 해설 보기</strong>
          </span>
          <IconNext />
        </Link>

        <section className={s.recent}>
          <h2>최근 그림</h2>
          <div className={s.recentGrid}>
            {works.slice(0, 4).map((w) => (
              <Link key={w.date} href={`/gallery/${w.date}`} className={s.recentItem}>
                <span className="art-frame">
                  <Picture scene={w.scene} imageUrl={w.imageUrl} alt={w.summary} />
                </span>
                <span className="hand">{monthDay(w.date)}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <BottomNav />
    </>
  );
}
