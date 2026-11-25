"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Picture from "@/components/Picture";
import { BottomNav, IconBack, IconNext, ProfileButton, Screen } from "@/components/ui";
import { monthDay, WEEKDAY_NAMES } from "@/lib/date";
import { sortedArtworks, useStore } from "@/lib/store";
import { buildJournalMonth, journalMonth, journalMonthStats, shiftJournalMonth, validJournalMonth } from "@/lib/journal-calendar";
import { useJournalToday } from "@/lib/use-journal-today";
import s from "./gallery.module.css";

export default function GalleryPage() {
  return (
    <Screen>
      <Suspense fallback={<div className="loading">달력을 불러오고 있어요…</div>}><GalleryRoute /></Suspense>
    </Screen>
  );
}

function GalleryRoute() {
  const params = useSearchParams();
  const today = useJournalToday();
  return <Gallery month={journalMonth(params.get("month"), today)} today={today} />;
}

function Gallery({ month, today }) {
  const router = useRouter();
  const { db } = useStore();
  const thisMonth = today.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const works = sortedArtworks(db);
  const previous = shiftJournalMonth(month, -1);
  const next = shiftJournalMonth(month, 1);
  const chooseMonth = value => {
    if (validJournalMonth(value) && value <= thisMonth) router.replace(`/gallery?month=${value}`, { scroll: false });
  };
  const cells = buildJournalMonth(db, month, today);
  const stats = journalMonthStats(db, month);

  return (
    <>
      <main className={`scroll ${s.main}`}>
        <div className={s.monthHead}>
          <h1 className="hand">
            {year}년 {monthNumber}월
          </h1>
          <div className={s.monthNav}>
            <button className="icon-btn" aria-label="이전 달" onClick={() => chooseMonth(previous)} disabled={!previous}>
              <IconBack />
            </button>
            <button className="icon-btn" aria-label="다음 달" onClick={() => chooseMonth(next)} disabled={!next || next > thisMonth}>
              <IconNext />
            </button>
            <ProfileButton />
          </div>
        </div>
        <div className={s.monthControls}>
          <label className={s.monthPicker}>월 선택<input type="month" value={month} min="0001-01" max={thisMonth} onChange={event => chooseMonth(event.target.value)} /></label>
          <button type="button" onClick={() => chooseMonth(thisMonth)} disabled={month === thisMonth}>이번 달</button>
        </div>
        <div className={s.stats}>{month === thisMonth ? "이번 달" : "이달"} 그림 {stats.artworkCount}장 · 조각글 {stats.entryCount}개</div>
        <p className={s.calendarHint}>빈 날짜를 눌러 지난 하루도 기록해 보세요.</p>

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
                  <Picture scene={db.artworks[c.key].scene} imageUrl={db.artworks[c.key].imageUrl} imageError={db.artworks[c.key].imageError} alt={db.artworks[c.key].summary} />
                  <span className={s.dnum}>{c.day} {db.artworks[c.key].status === "failed" ? "· 실패" : db.artworks[c.key].status !== "ready" ? "· 생성 중" : ""}</span>
                </Link>
              );
            if (c.kind === "today")
              return (
                <Link key={c.key} href="/today" className={s.today} aria-label={`오늘 기록하기, 조각글 ${c.entryCount}개`}>
                  <span className={s.todayNum}>{c.day}</span>
                  <span>{c.entryCount ? `${c.entryCount}조각` : "오늘"}</span>
                </Link>
              );
            if (c.kind === "future") return <div key={c.key} className={s.future} aria-label={`${monthDay(c.key)}, 아직 오지 않은 날`}><span>{c.day}</span></div>;
            return <Link key={c.key} href={`/gallery/${c.key}`} className={c.kind === "draft" ? s.draftDay : s.empty} aria-label={`${monthDay(c.key)} ${c.entryCount ? `조각글 ${c.entryCount}개 이어 쓰기` : "기록하기"}`}>
              <span className={s.dayNumber}>{c.day}</span>
              <span className={s.dayNote}>{c.entryCount ? `${c.entryCount}조각` : "+"}</span>
            </Link>;
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
            <strong>모아 둔 그림의 해설 보기</strong>
          </span>
          <IconNext />
        </Link>

        <Link href="/cartoon" className={s.cartoon}>
          <span className={s.cartoonIcon} aria-hidden="true">日</span>
          <span><small>하루만평 · 하루 한 장</small><strong>나의 하루, 세상의 하루</strong><span>같은 날짜의 두 그림을 펼쳐보세요.</span></span>
          <IconNext />
        </Link>

        <Link href="/connection" className={s.connection}>
          <span className={s.connectionMark} aria-hidden="true">↗</span>
          <span><small>하루연결 · 나만의 뉴스</small><strong>내 일기에서 그 무렵의 세상으로</strong><span>일기 날짜 기준 한 달의 뉴스, 두 장의 그림으로.</span></span>
          <IconNext />
        </Link>

        <section className={s.recent}>
          <h2>최근 그림</h2>
          <div className={s.recentGrid}>
            {works.slice(0, 4).map((w) => (
              <Link key={w.date} href={`/gallery/${w.date}`} className={s.recentItem}>
                <span className="art-frame">
                  <Picture scene={w.scene} imageUrl={w.imageUrl} imageError={w.imageError} alt={w.summary} />
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
