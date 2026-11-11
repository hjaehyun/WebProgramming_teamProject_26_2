"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Picture from "@/components/Picture";
import SongCard from "@/components/SongCard";
import { IconBack, IconNext, Screen, TopBar } from "@/components/ui";
import { clock, longDate } from "@/lib/date";
import { generateArtwork } from "@/lib/ai";
import { downloadImage } from "@/lib/download";
import { byTime, sortedArtworks, useStore } from "@/lib/store";
import { canChooseExhibitionArtwork } from "@/lib/exhibition-selection";
import { styleOf, withParticle } from "@/lib/styles";
import s from "./detail.module.css";

export default function DetailPage() {
  return (
    <Screen>
      <Detail />
    </Screen>
  );
}

function Detail() {
  const { date } = useParams();
  const router = useRouter();
  const { db, toggleExhibit, applyArtwork, requestSong, voteSong, refresh, exhibitionSaving } = useStore();
  const art = db.artworks[date];
  const [saving, setSaving] = useState(false);
  const [redrawing, setRedrawing] = useState(false);
  const [songBusy, setSongBusy] = useState(false);
  const [songNote, setSongNote] = useState(null);
  const [liked, setLiked] = useState(null); // song id liked in this visit

  async function song(reroll) {
    if (songBusy) return;
    setSongBusy(true);
    setSongNote(null);
    try {
      const r = await requestSong(date, reroll);
      if (reroll && r.unchanged) setSongNote("다른 곡이 아직 없어요");
    } catch (err) {
      alert(err instanceof Error ? err.message : "노래를 찾지 못했어요");
    } finally {
      setSongBusy(false);
    }
  }

  async function like(id) {
    setLiked(id);
    try {
      await voteSong(id, 1);
    } catch (err) {
      setLiked(null);
      alert(err instanceof Error ? err.message : "저장하지 못했어요");
    }
  }

  /** "다시 그리기": same fragments, summarized and drawn again in the current profile style. */
  async function redraw() {
    if (!art || redrawing) return;
    const style = db.profile?.style ?? art.style;
    const ok = confirm(
      `${withParticle(style)} ${art.status === "failed" ? "다시 시도할까요?" : "다시 그릴까요?"}\n이날 그림은 실패를 포함해 총 3회까지 생성할 수 있어요. 새 그림이 완성되면 바뀝니다.`,
    );
    if (!ok) return;
    setRedrawing(true);
    try {
      await generateArtwork(date, art.status === "ready", applyArtwork);
    } catch (err) {
      alert(err instanceof Error ? err.message : "다시 그리지 못했어요");
    } finally {
      await refresh();
      setRedrawing(false);
    }
  }

  async function download() {
    if (!art?.imageUrl || saving) return;
    setSaving(true);
    try {
      await downloadImage(art.imageUrl, `하루조각-${date}.png`);
    } catch {
      alert("그림을 저장하지 못했어요");
    } finally {
      setSaving(false);
    }
  }

  if (!art) {
    return (
      <>
        <TopBar title={longDate(date)} back="/gallery" />
        <div className="loading">이날은 그림이 없어요.</div>
      </>
    );
  }

  // Newest first, so "previous day" is the next index.
  const list = sortedArtworks(db);
  const i = list.findIndex((w) => w.date === date);
  const older = list[i + 1]?.date;
  const newer = list[i - 1]?.date;
  const inShow = db.exhibition.dates.includes(date);

  return (
    <>
      <TopBar title={longDate(date)} back="/gallery">
        <button className="icon-btn" aria-label="전날 그림" disabled={!older} onClick={() => older && router.replace(`/gallery/${older}`)}>
          <IconBack />
        </button>
        <button className="icon-btn" aria-label="다음날 그림" disabled={!newer} onClick={() => newer && router.replace(`/gallery/${newer}`)}>
          <IconNext />
        </button>
      </TopBar>

      <main className={`scroll ${s.main}`}>
        <figure className={s.figure}>
          <span className={s.frame} aria-busy={redrawing}>
            <Picture scene={art.scene} imageUrl={art.imageUrl} imageError={art.imageError} alt={art.summary} />
          </span>
          <figcaption>
            <span className={s.badge}>{styleOf(art.style).label}</span>
            <span role="status">{redrawing || ["queued", "processing"].includes(art.status) ? "그리는 중… 화면을 닫아도 작업은 이어져요." : art.status === "failed" ? art.error || "생성에 실패했어요. 다시 시도해 주세요." : art.imageUrl ? "" : "그림을 불러오지 못했어요."}</span>
          </figcaption>
        </figure>

        <section className="card">
          <h2 className={`eyebrow ${s.h}`}>AI가 정리한 장면</h2>
          <p className={s.summary}>{art.summary}</p>
          {art.tags.length > 0 && (
            <div className={s.tags}>
              {art.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
        </section>

        <SongCard
          available={!!db.capabilities?.music}
          song={art.song}
          busy={songBusy || redrawing}
          liked={!!art.song && liked === art.song.id}
          note={db.capabilities?.music ? songNote : "노래 추천 연결 준비 중"}
          onRequest={() => song(false)}
          onReroll={() => song(true)}
          onLike={() => art.song && like(art.song.id)}
        />

        <section className={s.entries}>
          <h2>그날의 조각 {art.entries.length}개</h2>
          {[...art.entries].sort(byTime).map((e) => {
            const t = clock(e.at);
            return (
              <div key={e.id} className={s.entry}>
                <span>
                  {t.am ? "오전" : "오후"} {t.label}
                </span>
                <p className="hand">{e.text}</p>
              </div>
            );
          })}
        </section>
      </main>

      <div className={`bar ${s.actions}`}>
        <button className={s.download} aria-label="그림 저장" title="그림 저장" onClick={download} disabled={saving || redrawing || !art.imageUrl}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
        </button>
        <button
          className="btn ghost"
          onClick={redraw}
          disabled={redrawing || !art.canRetry || art.entries.length === 0}
          title={art.entries.length === 0 ? "조각이 없는 날은 다시 그릴 수 없어요" : undefined}
        >
          {redrawing ? "그리는 중…" : art.status === "failed" ? "다시 시도" : "다시 그리기"}
        </button>
        <button className={inShow ? "btn ghost" : "btn"} onClick={() => toggleExhibit(date)} disabled={exhibitionSaving || (redrawing && !inShow) || !canChooseExhibitionArtwork(art, db.exhibition.dates)}>
          {inShow ? "전시회에서 내리기" : "전시회에 걸기"}
        </button>
      </div>
    </>
  );
}
