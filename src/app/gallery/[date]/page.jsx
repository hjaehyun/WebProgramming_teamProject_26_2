"use client";

import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Picture from "@/components/Picture";
import SongCard from "@/components/SongCard";
import Weather from "@/components/Weather";
import { IconBack, IconNext, Screen, TopBar } from "@/components/ui";
import { clock, dateKeyOf, longDate, todayKey } from "@/lib/date";
import { generateArtwork } from "@/lib/ai";
import { downloadImage } from "@/lib/download";
import { byTime, sortedArtworks, useStore } from "@/lib/store";
import { canChooseExhibitionArtwork } from "@/lib/exhibition-selection";
import { styleOf, withParticle } from "@/lib/styles";
import s from "./detail.module.css";

export default function DetailPage() {
  const { date } = useParams();
  // Keyed by day: a half-written or half-edited fragment must not follow the 전날/다음날 buttons.
  return (
    <Screen>
      <Detail key={date} />
    </Screen>
  );
}

function Detail() {
  const { date } = useParams();
  const router = useRouter();
  const { db, toggleExhibit, applyArtwork, requestSong, voteSong, refresh, exhibitionSaving, addEntry, editEntry, removeEntry, flushEntries } = useStore();
  const art = db.artworks[date];
  const [saving, setSaving] = useState(false);
  const [redrawing, setRedrawing] = useState(false);
  const [openId, setOpenId] = useState(null); // fragment showing 수정/지우기
  const [editingId, setEditingId] = useState(null); // fragment whose text is in the input
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState(false); // last fragment (and the picture) being removed
  const input = useRef(null);
  const [songBusy, setSongBusy] = useState(false);
  const [songNote, setSongNote] = useState(null); // { date, text }: shown only on the picture it belongs to
  const [liked, setLiked] = useState(null); // song id liked in this visit

  async function song(reroll) {
    if (songBusy) return;
    setSongBusy(true);
    setSongNote(null);
    try {
      const r = await requestSong(date, reroll);
      // No song after asking: the AI found no clear mood for this day (or it was drawn before moods existed).
      if (!r.song) setSongNote({ date, text: "노래 추천 없음" });
      else if (reroll && r.unchanged) setSongNote({ date, text: "다른 곡이 아직 없어요" });
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

  /** "다시 그리기": the day's current fragments, summarized and drawn again in the current profile style. */
  async function redraw() {
    if (!art || redrawing || removing) return;
    const style = db.profile?.style ?? art.style;
    const ok = confirm(
      `${withParticle(style)} ${art.status === "failed" ? "다시 시도할까요?" : "다시 그릴까요?"}\n${art.entriesChanged ? "지금의 조각으로 새로 그려요. " : ""}이날 그림은 실패를 포함해 총 3회까지 생성할 수 있어요. 새 그림이 완성되면 바뀝니다.`,
    );
    if (!ok) return;
    cancelEdit();
    setOpenId(null);
    setRedrawing(true);
    try {
      await flushEntries(); // fragment changes still being saved must reach the server before it re-reads them
      await generateArtwork(date, art.status === "ready", applyArtwork);
    } catch (err) {
      alert(err instanceof Error ? err.message : "다시 그리지 못했어요");
    } finally {
      await refresh();
      setRedrawing(false);
    }
  }

  // Fragments of a finished (or failed) day can change; not while its picture is being drawn.
  const editable = !!art && ["ready", "failed"].includes(art.status) && !redrawing && !removing;

  function submit() {
    const text = draft.trim();
    if (!text || !editable) return;
    if (editingId) {
      // Only send when the text really changed.
      const old = art.entries.find((e) => e.id === editingId);
      if (old && old.text !== text) editEntry(date, editingId, text);
      cancelEdit();
      return;
    }
    addEntry(date, text);
    setDraft("");
    setOpenId(null);
  }

  function startEdit(e) {
    setEditingId(e.id);
    setDraft(e.text);
    setOpenId(null);
    input.current?.focus();
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  async function remove(e) {
    setOpenId(null);
    if (e.id === editingId) cancelEdit();
    if (art.entries.length > 1) {
      removeEntry(date, e.id);
      return;
    }
    const ok = confirm("마지막 조각을 지우면 이날 그림도 함께 지워져요.\n전시회에 건 그림이라면 전시에서도 빠지고, 되돌릴 수 없어요. 지울까요?");
    if (!ok) return;
    setRemoving(true);
    try {
      await removeEntry(date, e.id);
      router.replace(date === todayKey() ? "/today" : "/gallery");
    } catch {
      setRemoving(false); // the store already showed the error and reloaded the day
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
          note={db.capabilities?.music ? (songNote?.date === date ? songNote.text : null) : "노래 추천 연결 준비 중"}
          onRequest={() => song(false)}
          onReroll={() => song(true)}
          onLike={() => art.song && like(art.song.id)}
        />

        <section className={s.entries}>
          <h2>그날의 조각 {art.entries.length}개</h2>
          {art.entriesChanged && ["ready", "failed"].includes(art.status) && (
            <p className={s.changed} role="status">
              {art.canRetry
                ? `조각이 바뀌었어요. 다시 그리면 지금의 조각으로 새 그림을 그려요. (남은 횟수 ${3 - art.attempts}회)`
                : "조각이 바뀌었어요. 이날 그림은 3회를 모두 그려서 그림은 그대로 남아요."}
            </p>
          )}
          {[...art.entries].sort(byTime).map((e) => {
            const t = clock(e.at);
            // Added on a later day: the clock time alone would read as a time of this day.
            const [, m, d] = dateKeyOf(e.at).split("-");
            const later = dateKeyOf(e.at) !== date;
            const open = openId === e.id && editable;
            return (
              <div key={e.id} className={s.group}>
                <div className={s.entry}>
                  <span>
                    {later ? <>{Number(m)}/{Number(d)}<br />더함</> : <>{t.am ? "오전" : "오후"} {t.label}</>}
                    <Weather weather={e.weather} at={e.at} />
                  </span>
                  <button
                    className={`hand ${s.text} ${open || editingId === e.id ? s.sel : ""}`}
                    onClick={() => setOpenId(open ? null : e.id)}
                    disabled={!editable}
                    aria-expanded={open}
                  >
                    {e.text}
                  </button>
                </div>
                {open && (
                  <div className={s.acts}>
                    <button className={s.act} onClick={() => startEdit(e)}>
                      수정
                    </button>
                    <button className={`${s.act} ${s.del}`} onClick={() => remove(e)}>
                      지우기
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {editable && (
            <div className={s.composer}>
              {editingId && (
                <div className={s.editBar} role="status">
                  <span>조각을 고치는 중이에요</span>
                  <button onClick={cancelEdit}>취소</button>
                </div>
              )}
              <div className={s.inputRow}>
                {/* aria-label, not an .sr-only <label>: that absolutely positioned label would sit below
                    the .app frame from inside this scroll area, and focusing the input would scroll the frame. */}
                <input
                  ref={input}
                  aria-label={editingId ? "고칠 조각" : "이날의 조각 더하기"}
                  className={s.input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
                    if (e.key === "Escape" && editingId) cancelEdit();
                  }}
                  placeholder={editingId ? "고칠 내용을 한 줄로…" : "이날의 조각을 더해 보세요"}
                  maxLength={140}
                />
                <button className={s.send} onClick={submit} disabled={!draft.trim()} aria-label={editingId ? "수정 저장" : "조각 더하기"}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
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
          disabled={redrawing || removing || !art.canRetry || art.entries.length === 0}
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
