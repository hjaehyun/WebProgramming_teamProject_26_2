"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Art from "@/components/Art";
import Picture from "@/components/Picture";
import { Screen, TopBar } from "@/components/ui";
import { curationStats, writeCuration } from "@/lib/ai";
import type { CurationText } from "@/lib/types";
import { addDays, todayKey } from "@/lib/date";
import { sortedArtworks, useStore } from "@/lib/store";
import s from "./curator.module.css";

export default function CuratorPage() {
  return (
    <Screen>
      <Curator />
    </Screen>
  );
}

type Period = "week" | "month" | "season";

function range(p: Period): { from: string; label: string } {
  const today = todayKey();
  const d = new Date();
  if (p === "week") return { from: addDays(today, -6), label: "이번 주" };
  if (p === "month") return { from: today.slice(0, 8) + "01", label: `${d.getMonth() + 1}월` };
  const m = d.getMonth(); // seasons: 봄 3-5, 여름 6-8, 가을 9-11, 겨울 12-2
  const names = ["겨울", "겨울", "봄", "봄", "봄", "여름", "여름", "여름", "가을", "가을", "가을", "겨울"];
  const startMonth = [11, 11, 2, 2, 2, 5, 5, 5, 8, 8, 8, 11][m];
  const year = m < 2 ? d.getFullYear() - 1 : d.getFullYear();
  return { from: `${year}-${String(startMonth + 1).padStart(2, "0")}-01`, label: names[m] };
}

const MIN_WORKS = 3;

function Curator() {
  const { db } = useStore();
  const [period, setPeriod] = useState<Period>("month");
  const periods: Period[] = ["week", "month", "season"];
  const { from, label } = range(period);
  const works = sortedArtworks(db).filter((w) => w.date >= from);
  const enough = works.length >= MIN_WORKS;
  const c = enough ? curationStats(works) : null;

  // Commentary comes from the text AI; keyed by period + artwork set so stale replies are ignored.
  const key = `${period}:${works.map((w) => w.date).join(",")}`;
  const [text, setText] = useState<{ key: string; value: CurationText | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!enough) return;
    let live = true;
    writeCuration(works, curationStats(works), label)
      .then((value) => live && setText({ key, value, error: null }))
      .catch((err: Error) => live && setText({ key, value: null, error: err.message }));
    return () => {
      live = false;
    };
    // works/label are derived from key; listing them would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enough]);

  const t = text?.key === key ? text : null;

  return (
    <>
      <TopBar title="AI 큐레이터" back="/gallery" />
      <main className={`scroll ${s.main}`}>
        <div role="group" aria-label="기간" className={s.chips}>
          {periods.map((p) => (
            <button key={p} className={p === period ? "chip on" : "chip"} aria-pressed={p === period} onClick={() => setPeriod(p)}>
              {range(p).label}
            </button>
          ))}
        </div>

        {!c ? (
          <div className={`card ${s.empty}`}>
            <strong className="hand">아직 해설하기엔 그림이 적어요</strong>
            <p>
              {label} 그림이 {works.length}장이에요. {MIN_WORKS}장 이상 모이면 해설을 써 드릴게요.
            </p>
          </div>
        ) : (
          <>
            <div className={s.thumbs}>
              {c.picks.map((d) => (
                <Link key={d} href={`/gallery/${d}`} className="art-frame">
                  <Picture scene={db.artworks[d].scene} imageUrl={db.artworks[d].imageUrl} alt={db.artworks[d].summary} />
                </Link>
              ))}
            </div>

            <article className={`card ${s.article}`}>
              <div className="eyebrow">{label}의 해설</div>
              {t?.value ? (
                <>
                  <h2 className="hand">{t.value.headline}</h2>
                  <p>{t.value.body}</p>
                </>
              ) : (
                <p>{t?.error ?? "해설을 쓰고 있어요…"}</p>
              )}
            </article>

            <section className={s.top}>
              <h2>자주 등장한 순간</h2>
              {c.top.map((t) => (
                <div key={t.tag} className={s.topRow}>
                  <span className={s.topArt}>
                    <Art scene={t.scene} />
                  </span>
                  <span className={s.topTag}>#{t.tag}</span>
                  <span className={s.topCount}>{t.count}번</span>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
      <div className="bar">
        <Link href="/exhibition/pick" className="btn">
          이 해설로 전시 만들기
        </Link>
      </div>
    </>
  );
}
