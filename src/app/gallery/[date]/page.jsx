"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Framed from "@/components/Framed";
import Picture from "@/components/Picture";
import SongCard from "@/components/SongCard";
import Weather from "@/components/Weather";
import { IconBack, IconNext, Screen, TopBar } from "@/components/ui";
import { clock, dateKeyOf, longDate } from "@/lib/date";
import { generateArtwork } from "@/lib/ai";
import { downloadImage } from "@/lib/download";
import { byTime, useStore } from "@/lib/store";
import { shiftJournalDay, validJournalDate } from "@/lib/journal-calendar";
import { createJournalDraftSaver, journalLinkDestination } from "@/lib/journal-draft";
import { useJournalToday } from "@/lib/use-journal-today";
import { canChooseExhibitionArtwork } from "@/lib/exhibition-selection";
import { FRAMES, dayWeathers, frameOf } from "@/lib/frames";
import { styleOf, withParticle } from "@/lib/styles";
import s from "./detail.module.css";

export default function DetailPage() {
  const { date } = useParams();
  const today = useJournalToday();
  const valid = validJournalDate(date);
  const future = valid && date > today;
  // Input belongs to its day in the session store, so route remounts can restore it.
  return (
    <Screen>
      {valid && !future ? <Detail key={date} date={date} today={today} /> : <>
        <TopBar title="날짜 확인" back="/gallery" />
        <div className={s.invalidDay} role="status"><h2>{future ? "아직 오지 않은 날이에요" : "날짜를 확인해 주세요"}</h2><p>{future ? "오늘까지의 하루를 골라 기록할 수 있어요." : "달력에서 기록할 날짜를 다시 골라 주세요."}</p><Link className="btn ghost" href="/gallery">달력으로 돌아가기</Link></div>
      </>}
    </Screen>
  );
}

function Detail({ date, today }) {
  const router = useRouter();
  const { db, toggleExhibit, applyArtwork, requestSong, voteSong, refresh, exhibitionSaving, addEntry, editEntry, removeEntry, flushEntries, setFrame, journalComposers, setJournalComposer, isCurrentSession } = useStore();
  const art = db.artworks[date];
  const entries = [...(art?.entries ?? db.drafts[date] ?? [])].sort(byTime);
  const [saving, setSaving] = useState(false);
  const [redrawing, setRedrawing] = useState(false);
  const [openId, setOpenId] = useState(null); // fragment showing 수정/지우기
  const composer = journalComposers?.[date];
  const editingId = composer?.editingId ?? null;
  const draft = composer?.draft ?? "";
  const entrySaving = !!composer?.saving;
  const saveNote = composer?.note ?? null;
  const writing = useRef(false);
  const [removing, setRemoving] = useState(false); // last fragment (and the picture) being removed
  const [connecting, setConnecting] = useState(false);
  const input = useRef(null);
  const [songBusy, setSongBusy] = useState(false);
  const [songNote, setSongNote] = useState(null); // { date, text }: shown only on the picture it belongs to
  const [liked, setLiked] = useState(null); // song id liked in this visit

  function cancelEdit() {
    if (entrySaving || writing.current) return;
    setJournalComposer(date, null);
  }

  async function saveInput() {
    if (entrySaving || writing.current) return false;
    writing.current = true;
    const saver = composer?.saver ?? createJournalDraftSaver();
    setJournalComposer(date, { saver, saving: true, note: null });
    const result = await saver.save({ date, text: draft.trim(), editingId, entries }, { addEntry, editEntry, flushEntries, refresh, isCurrentSession });
    writing.current = false;
    if (!isCurrentSession()) return false;
    if (result.saved) setJournalComposer(date, null);
    else setJournalComposer(date, { saving: false, note: result.error instanceof Error ? result.error.message : "저장하지 못했어요. 입력한 글은 그대로 남아 있어요." });
    if (result.error && result.saved) alert(result.error instanceof Error ? result.error.message : "저장하지 못한 다른 조각을 확인해 주세요.");
    return !result.error;
  }

  async function navigate(href, replace = false) {
    if (entrySaving || writing.current || redrawing || removing || connecting) return;
    if (draft || editingId) {
      if (!confirm("입력 중인 조각을 저장하고 이동할까요?\n취소하면 이 날짜에서 계속 쓸 수 있어요.")) return;
      if (!editable || !await saveInput()) return;
    }
    if (replace) router.replace(href);
    else router.push(href);
  }

  function guardLink(event) {
    const href = journalLinkDestination(event, window.location);
    if (!href || (!draft && !editingId && !entrySaving)) return;
    event.preventDefault();
    event.stopPropagation();
    void navigate(href);
  }

  async function song(reroll) {
    if (songBusy) return;
    setSongBusy(true);
    setSongNote(null);
    try {
      const r = await requestSong(date, reroll);
      // Handle an empty response; a missing mood normally uses the server's default calm song list.
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

  /** Save the input first, then wait for every fragment write before drawing this day's snapshot. */
  async function redraw() {
    if (entrySaving || writing.current || redrawing || removing || connecting || (art && !art.canRetry) || (!entries.length && !draft.trim()) || (editingId && !draft.trim())) return;
    const style = db.profile?.style ?? art?.style;
    if (art && !confirm(
      `${withParticle(style)} ${art.status === "failed" ? "다시 시도할까요?" : "다시 그릴까요?"}\n${draft.trim() ? "입력 중인 조각을 먼저 저장해요. " : art.entriesChanged ? "지금의 조각으로 새로 그려요. " : ""}이날 그림은 실패를 포함해 총 3회까지 생성할 수 있어요. 새 그림이 완성되면 바뀝니다.`,
    )) return;
    setOpenId(null);
    setRedrawing(true);
    try {
      if (!await saveInput()) return;
      await generateArtwork(date, art?.status === "ready", applyArtwork);
    } catch (err) {
      alert(err instanceof Error ? err.message : "그림을 그리지 못했어요");
    } finally {
      await refresh();
      setRedrawing(false);
    }
  }

  // A valid unpictured day can be written too; a queued or processing picture stays locked.
  const editable = (!art || ["ready", "failed"].includes(art.status)) && !redrawing && !removing && !connecting;

  async function openConnection() {
    if (entrySaving || writing.current || connecting || redrawing || removing || (editingId && !draft.trim())) return;
    if (draft.trim() && !editable) {
      alert("그림을 만드는 동안에는 입력 중인 조각을 저장할 수 없어요. 그림이 완성된 뒤 저장하고 이동해 주세요.");
      return;
    }
    setConnecting(true);
    try {
      if (!await saveInput()) return;
      router.push(`/connection?date=${date}`);
    } finally { setConnecting(false); }
  }

  async function submit() {
    const text = draft.trim();
    if (!text || !editable || entrySaving || writing.current) return;
    setOpenId(null);
    await saveInput();
  }

  function startEdit(e) {
    if (entrySaving || writing.current) return;
    if ((draft || editingId) && !confirm("입력 중인 내용을 바꾸고 이 조각을 수정할까요?")) return;
    setJournalComposer(date, { editingId: e.id, draft: e.text, saver: null, note: null });
    setOpenId(null);
    input.current?.focus();
  }

  async function remove(e) {
    if (entrySaving || writing.current) return;
    setOpenId(null);
    if (!art || entries.length > 1) {
      try {
        await removeEntry(date, e.id);
        if (e.id === editingId) cancelEdit();
      } catch { /* The store reports the failure and reloads the record. */ }
      return;
    }
    const ok = confirm("마지막 조각을 지우면 이날 그림도 함께 휴지통으로 가요.\n전시회에 건 그림이라면 전시에서는 빠지고, 30일 안에 마이페이지의 휴지통에서 되살릴 수 있어요. 지울까요?");
    if (!ok) return;
    setRemoving(true);
    try {
      await removeEntry(date, e.id);
      if (e.id === editingId) cancelEdit();
      await refresh();
    } catch {
      // The store already showed the error and reloaded the day.
    } finally {
      setRemoving(false);
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

  const older = shiftJournalDay(date, -1);
  const newer = date < today ? shiftJournalDay(date, 1) : null;
  const inShow = db.exhibition.dates.includes(date);

  return (
    <div className={s.detail} onClickCapture={guardLink}>
      <TopBar title={`${Number(date.slice(0, 4))}년 ${longDate(date)}`} back={`/gallery?month=${date.slice(0, 7)}`}>
        <button className="icon-btn" aria-label="전날 기록" disabled={!older || entrySaving || redrawing || removing || connecting} onClick={() => older && navigate(`/gallery/${older}`, true)}>
          <IconBack />
        </button>
        <button className="icon-btn" aria-label="다음날 기록" disabled={!newer || entrySaving || redrawing || removing || connecting} onClick={() => newer && navigate(`/gallery/${newer}`, true)}>
          <IconNext />
        </button>
      </TopBar>

      <main className={`scroll ${s.main}`}>
        <div className={s.artColumn}>
        {art ? <>
        <figure className={s.figure} aria-busy={redrawing}>
          <Framed frame={art.frame} date={date} summary={art.summary} weathers={dayWeathers(art.entries)} basicClassName={s.frame}>
            <Picture scene={art.scene} imageUrl={art.imageUrl} imageError={art.imageError} alt={art.summary} />
          </Framed>
          <figcaption>
            <span className={s.badge}>{styleOf(art.style).label}</span>
            <span role="status">{redrawing || ["queued", "processing"].includes(art.status) ? "그리는 중… 화면을 닫아도 작업은 이어져요." : art.status === "failed" ? art.error || "생성에 실패했어요. 다시 시도해 주세요." : art.imageUrl ? "" : "그림을 불러오지 못했어요."}</span>
          </figcaption>
        </figure>

        {art.status === "ready" && (
          <fieldset className={s.frames} disabled={redrawing}>
            <legend>액자</legend>
            <div className={s.chips}>
              {FRAMES.map((f) => (
                <label key={f.id} className={s.chip}>
                  <input type="radio" name="frame" value={f.id} checked={frameOf(art.frame) === f.id} onChange={() => setFrame(date, f.id)} />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

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
        </> : <section className={s.emptyDay} aria-live="polite">
          <span aria-hidden="true">✦</span><h2 className="hand">{redrawing ? "이날의 그림을 준비하고 있어요" : "기억나는 하루를 채워보세요"}</h2>
          <p>{redrawing ? "조각을 모아 한 장면으로 그려드릴게요." : "조각글을 남기고, 원할 때 한 장의 그림으로 완성해 보세요."}</p>
          {!redrawing && <small>그림이 없어도 조각글은 그대로 저장돼요.</small>}
        </section>}
        </div>

        <div className={s.journalColumn}>
        <Link href={`/cartoon?date=${encodeURIComponent(date)}`} className={s.cartoonLink}>
          <span><small>같은 날, 다른 시선</small><strong>이날의 만평과 나란히 보기</strong></span><IconNext />
        </Link>
        <button type="button" className={s.connectionLink} onClick={openConnection} disabled={entrySaving || connecting || redrawing || removing || !!(draft.trim() && !editable) || !!(editingId && !draft.trim())}>
          <span><small>하루연결 · 내 기록에서 그 무렵의 뉴스로</small><strong>{connecting ? "조각을 저장하고 있어요…" : "내 하루와 이어지는 뉴스 보기"}</strong><span>{draft.trim() && !editable && !connecting ? "그림 완성 후 입력한 조각을 저장하고 이동해 주세요." : draft.trim() ? "입력 중인 조각을 저장하고 이동해요." : "그림이 없어도 글로 연결할 수 있어요."}</span></span><IconNext />
        </button>

        {art && <SongCard
          available={!!db.capabilities?.music}
          song={art.song}
          busy={songBusy || redrawing}
          liked={!!art.song && liked === art.song.id}
          note={db.capabilities?.music ? (songNote?.date === date ? songNote.text : null) : "노래 추천 연결 준비 중"}
          onRequest={() => song(false)}
          onReroll={() => song(true)}
          onLike={() => art.song && like(art.song.id)}
        />}

        <section className={s.entries}>
          <h2>그날의 조각 {entries.length}개</h2>
          {art?.entriesChanged && ["ready", "failed"].includes(art.status) && (
            <p className={s.changed} role="status">
              {art.canRetry
                ? `조각이 바뀌었어요. 다시 그리면 지금의 조각으로 새 그림을 그려요. (남은 횟수 ${3 - art.attempts}회)`
                : "조각이 바뀌었어요. 이날 그림은 3회를 모두 그려서 그림은 그대로 남아요."}
            </p>
          )}
          {entries.map((e) => {
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
                    disabled={!editable || entrySaving}
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
                  <button onClick={cancelEdit} disabled={entrySaving}>취소</button>
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
                  disabled={entrySaving}
                  onChange={(e) => setJournalComposer(date, { draft: e.target.value, note: null })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
                    if (e.key === "Escape" && editingId) cancelEdit();
                  }}
                  placeholder={editingId ? "고칠 내용을 한 줄로…" : "이날 기억나는 순간을 한 줄로…"}
                  maxLength={140}
                />
                <button className={s.send} onClick={submit} disabled={!draft.trim() || entrySaving} aria-label={editingId ? "수정 저장" : "조각 더하기"}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
              {(draft || editingId || entrySaving || saveNote) && <p className={saveNote ? s.saveError : s.draftHint} role={saveNote ? "alert" : "status"}>
                {saveNote ?? (entrySaving ? "조각을 저장하고 있어요…" : "아직 저장하지 않은 글이에요. 다른 날에 다녀와도 이 화면에서 이어 쓸 수 있어요.")}
              </p>}
            </div>
          )}
        </section>
        </div>
      </main>

      <div className={`bar ${s.actions}`}>
        {art ? <>
        <button className={s.download} aria-label="그림 저장" title="그림 저장" onClick={download} disabled={saving || redrawing || !art.imageUrl}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
        </button>
        <button
          className="btn ghost"
          onClick={redraw}
          disabled={entrySaving || redrawing || removing || connecting || !art.canRetry || (!entries.length && !draft.trim()) || !!(editingId && !draft.trim())}
          title={!entries.length && !draft.trim() ? "조각을 남기면 그림을 그릴 수 있어요" : undefined}
        >
          {redrawing ? "그리는 중…" : art.status === "failed" ? "다시 시도" : "다시 그리기"}
        </button>
        <button className={inShow ? "btn ghost" : "btn"} onClick={() => toggleExhibit(date)} disabled={exhibitionSaving || (redrawing && !inShow) || !canChooseExhibitionArtwork(art, db.exhibition.dates)}>
          {inShow ? "전시회에서 내리기" : "전시회에 걸기"}
        </button>
        </> : <button className="btn" onClick={redraw} disabled={entrySaving || redrawing || removing || connecting || (!entries.length && !draft.trim()) || !!(editingId && !draft.trim())}>
          {redrawing ? "그림을 준비하는 중…" : draft.trim() ? "조각 저장하고 그림 그리기" : "이날의 그림 그리기"}
        </button>}
      </div>
    </div>
  );
}
