"use client";

import Link from "next/link";
import { useState } from "react";
import Picture from "@/components/Picture";
import { BottomNav, IconNext, ProfileButton, Screen } from "@/components/ui";
import { monthDay } from "@/lib/date";
import { useStore } from "@/lib/store";
import s from "./exhibition.module.css";

export default function ExhibitionPage() {
  return (
    <Screen>
      <Exhibition />
    </Screen>
  );
}

function Exhibition() {
  const { db, setExhibitPublic, exhibitionSaving } = useStore();
  const ex = db.exhibition;
  const works = ex.dates.map((d) => db.artworks[d]).filter(Boolean);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!ex.id) return;
    // Same URL the public viewer reads: /e/<exhibitions.id> -> GET /api/exhibitions/:id
    const url = `${location.origin}/e/${ex.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      alert("링크를 복사하지 못했어요. 공개 전시 미리보기에서 주소를 복사해 주세요.");
      return;
    }
    setCopied(true);
  }

  return (
    <>
      <main className={`scroll ${s.main}`}>
        <div className={s.titleRow}>
          <div className={s.title}>
            <div className="eyebrow">나의 전시회</div>
            <h1 className="hand">{ex.title}</h1>
            <p>{ex.desc}</p>
          </div>
          <ProfileButton />
        </div>

        <div className={`card ${s.vis}`}>
          <div className={s.visRow}>
            <div>
              <strong>{ex.isPublic ? "공개 중" : "나만 보기"}</strong>
              <span>{ex.isPublic ? "링크가 있는 사람은 누구나 볼 수 있어요" : "전시에 건 그림도 다른 사람에게 안 보여요"}</span>
            </div>
            <button
              role="switch"
              aria-checked={ex.isPublic}
              aria-label="전시 공개"
              disabled={exhibitionSaving}
              className={ex.isPublic ? `${s.sw} ${s.swOn}` : s.sw}
              onClick={() => {
                setExhibitPublic(!ex.isPublic);
                setCopied(false);
              }}
            >
              <span className={s.knob} />
            </button>
          </div>
          {ex.isPublic && (
            <button className={s.copy} onClick={copy}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
                <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
              </svg>
              {copied ? "링크를 복사했어요" : "공개 링크 복사"}
            </button>
          )}
        </div>

        <section className={s.works}>
          <div className={s.worksHead}>
            <h2>걸린 그림 {works.length}점</h2>
          </div>
          <div className={s.grid}>
            {works.map((w, i) => (
              <figure key={w.date} className={s.work}>
                <Link href={`/gallery/${w.date}`} className={s.workArt}>
                  <Picture scene={w.scene} imageUrl={w.imageUrl} imageError={w.imageError} alt={w.summary} />
                  <span className={s.no}>{i + 1}</span>
                </Link>
                <figcaption>
                  <span>{monthDay(w.date)}</span>
                  <span className="hand">{w.entries[0]?.text ?? ""}</span>
                </figcaption>
              </figure>
            ))}
            <Link href="/exhibition/pick" className={s.add}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              그림 고르기
            </Link>
          </div>
        </section>

        {ex.id && <Link href={`/e/${ex.id}`} className={s.preview}>
          공개 전시 미리보기
          <IconNext />
        </Link>}
      </main>
      <BottomNav />
    </>
  );
}
