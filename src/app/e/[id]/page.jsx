"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Picture from "@/components/Picture";
import SongCard from "@/components/SongCard";
import { IconBack, IconNext } from "@/components/ui";
import { monthDay } from "@/lib/date";
import { fetchPublicExhibition } from "@/lib/exhibitions";
import { useStore } from "@/lib/store";
import s from "./public.module.css";

// Public viewer: no sign-in needed. Data comes from GET /api/exhibitions/:id (public exhibitions only).
export default function PublicExhibitPage() {
  const { id } = useParams();
  return <PublicExhibit key={id} id={id} />;
}

function PublicExhibit({ id }) {
  const { authed, db } = useStore();
  const [load, setLoad] = useState({ state: "loading" });
  const [i, setI] = useState(0);

  useEffect(() => {
    let live = true;
    fetchPublicExhibition(id)
      .then((ex) => live && setLoad(ex ? { state: "ok", ex } : { state: "missing" }))
      .catch((err) => live && setLoad({ state: "error", message: err instanceof Error ? err.message : "불러오지 못했어요" }));
    return () => {
      live = false;
    };
  }, [id]);

  // Owner preview opens this page in the same tab, so give them a way back.
  const isOwner = authed && db.exhibition.id === id;

  return (
    <div className="app dark">
      {isOwner && (
        <Link href="/exhibition" className={s.ownerBar}>
          <IconBack />
          내 전시로
        </Link>
      )}

      {load.state === "loading" && <div className="loading">불러오는 중…</div>}
      {load.state === "error" && <div className="loading">{load.message}</div>}
      {load.state === "missing" && (
        <main className={s.main}>
          <p className={s.closed}>비공개이거나 없는 전시예요</p>
        </main>
      )}
      {load.state === "ok" && !load.ex.isPublic && (
        <p className={s.privateNote} role="note">
          비공개 상태예요. 지금은 나만 볼 수 있어요.
        </p>
      )}
      {load.state === "ok" && <Gallery ex={load.ex} i={Math.min(i, load.ex.items.length - 1)} setI={setI} />}

      <footer className={s.foot}>
        <span className="hand">하루조각</span>
        <Link href="/">나도 전시 열기</Link>
      </footer>
    </div>
  );
}

function Gallery({ ex, i, setI }) {
  const cur = ex.items[i];
  return (
    <>
      <header className={s.head}>
        <div className={s.owner}>{ex.ownerNick ?? "이름 없는 작가"}의 전시</div>
        <h1 className="hand">{ex.title}</h1>
        <p>{ex.desc}</p>
      </header>

      <main className={s.main}>
        {!cur ? (
          <p className={s.closed}>아직 걸린 그림이 없어요.</p>
        ) : (
          <>
            <figure className={s.figure}>
              <div className={s.mat}>
                <Picture scene={cur.scene} imageUrl={cur.imageUrl} alt={cur.summary} />
              </div>
              <figcaption>
                <span>{monthDay(cur.date)}</span>
                <span className="hand">{cur.note ?? cur.summary}</span>
              </figcaption>
            </figure>
            <div className={s.pager}>
              <button className={s.nav} aria-label="이전 그림" onClick={() => setI(i - 1)} disabled={i === 0}>
                <IconBack />
              </button>
              <span>
                {i + 1} / {ex.items.length}
              </span>
              <button className={s.nav} aria-label="다음 그림" onClick={() => setI(i + 1)} disabled={i >= ex.items.length - 1}>
                <IconNext />
              </button>
            </div>
            <SongCard song={cur.song} readOnly dark />
          </>
        )}
      </main>
    </>
  );
}
