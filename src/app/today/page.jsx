"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Picture from "@/components/Picture";
import Weather from "@/components/Weather";
import { BottomNav, ProfileButton, Screen } from "@/components/ui";
import { generateArtwork } from "@/lib/ai";
import { clock, longDate, monthDay, todayKey, weekdayName } from "@/lib/date";
import { byTime, useStore } from "@/lib/store";
import { withParticle } from "@/lib/styles";
import s from "./today.module.css";

const PROMPTS = ["지금 날씨는?", "방금 뭐 먹었어?", "누구랑 있어?", "지금 기분 한 단어로", "눈에 띈 것 하나"];

export default function TodayPage() {
  return (
    <Screen>
      <Today />
    </Screen>
  );
}

// Stage reflects the saved server job, including after refresh or automatic close.
function Today() {
  const router = useRouter();
  const { db, addEntry, editEntry, removeEntry, applyArtwork, flushEntries, refresh } = useStore();
  const date = todayKey();
  const art = db.artworks[date];
  const style = db.profile.style;

  const [requesting, setRequesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectionOpening = useRef(false);
  const stage = art?.status === "ready" ? 3 : art?.status === "failed" ? 4 : art ? (art.phase === "drawing" ? 2 : 1) : requesting ? 1 : 0;
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [newId, setNewId] = useState(null);
  // The fragment whose text is in the input. The saved original is untouched until "저장".
  const [editingId, setEditingId] = useState(null);
  const feed = useRef(null);
  const input = useRef(null);

  const entries = [...(art ? art.entries : (db.drafts[date] ?? []))].sort(byTime);
  const n = entries.length;

  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [n, stage]);

  function add() {
    const text = draft.trim();
    if (!text || stage > 0 || connecting) return;
    if (editingId) {
      // Only send when the text really changed.
      const old = entries.find((e) => e.id === editingId);
      if (old && old.text !== text) editEntry(date, editingId, text);
      setEditingId(null);
      setDraft("");
      return;
    }
    const e = addEntry(date, text);
    setNewId(e.id);
    setDraft("");
    setHint(null);
    setOpenId(null);
  }

  // Starts editing: the text goes to the input, the original stays saved until "저장".
  function edit(id, text) {
    if (connecting) return;
    setEditingId(id);
    setDraft(text);
    setHint(null);
    setOpenId(null);
    input.current?.focus();
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  function remove(id) {
    if (connecting) return;
    if (id === editingId) cancelEdit();
    removeEntry(date, id);
  }

  async function close() {
    if (requesting || connecting) return;
    if (editingId) cancelEdit();
    setOpenId(null);
    setRequesting(true);
    try {
      await flushEntries(); // fragments still waiting for the location must reach the server before closing
      await generateArtwork(date, false, applyArtwork);
    } catch (err) {
      alert(err instanceof Error ? err.message : "그림을 그리지 못했어요");
    } finally {
      await refresh();
      setRequesting(false);
    }
  }

  async function openConnection() {
    if (connectionOpening.current || requesting || (editingId && !draft.trim())) return;
    if (draft.trim() && stage > 0 && stage < 3) {
      alert("그림을 만드는 동안에는 입력 중인 조각을 저장할 수 없어요. 그림이 완성된 뒤 저장하고 이동해 주세요.");
      return;
    }
    connectionOpening.current = true;
    setConnecting(true);
    let submitted = null;
    try {
      const text = draft.trim();
      if (text) {
        if (editingId) {
          const old = entries.find(entry => entry.id === editingId);
          if (!old) throw new Error("수정 중인 조각을 찾지 못했어요. 기록을 다시 확인해 주세요.");
          if (old.text !== text) editEntry(date, editingId, text);
          submitted = { id: editingId, text };
        } else submitted = { id: addEntry(date, text).id, text };
      }
      await flushEntries();
      cancelEdit();
      router.push(`/connection?date=${date}`);
    } catch (error) {
      const latest = await refresh();
      const saved = latest?.artworks?.[date]?.entries ?? latest?.drafts?.[date] ?? [];
      if (submitted && saved.some(entry => entry.id === submitted.id && entry.text === submitted.text)) cancelEdit();
      alert(error instanceof Error ? error.message : "조각을 저장하지 못했어요. 다시 확인해 주세요.");
    } finally { connectionOpening.current = false; setConnecting(false); }
  }

  const pieces = Array.from({ length: Math.min(8, Math.max(6, n)) }, (_, i) => i < n);
  const steps = [`조각글 ${n}개 모으기`, "한 장면으로 정리하기", `${withParticle(style)} 그리기`];


  return (
    <>
      <header className={s.head}>
        <div className={s.headText}>
          <div className={s.date}>
            {monthDay(date)} {weekdayName(date)}요일
          </div>
          <h1 className="hand">오늘의 조각</h1>
        </div>
        <div className={s.headSide}>
          <div className={s.counter}>
            <div className={s.pieces} aria-hidden="true">
              {pieces.map((on, i) => (
                <span key={i} className={on ? `${s.piece} ${s.pieceOn}` : s.piece} />
              ))}
            </div>
            <div>{n}개 모였어요</div>
          </div>
          <ProfileButton />
        </div>
      </header>

      <main ref={feed} className={`scroll ${s.feed}`}>
        <div className={s.journal}>
        <div className={s.divider}>{longDate(date)}</div>

        {n === 0 && stage === 0 && (
          <div className={s.empty}>
            <div className="hand">아직 조용한 하루네요</div>
            <p>
              잘 쓰려고 하지 않아도 돼요.
              <br />
              혼잣말 한 줄이면 충분해요.
            </p>
          </div>
        )}

        {entries.map((e, index) => {
          const t = clock(e.at);
          const showDivider = index === 0 || t.am !== clock(entries[index - 1].at).am;
          const open = openId === e.id && stage === 0;
          const editing = editingId === e.id;
          return (
            <div key={e.id} className={s.group}>
              {showDivider && <div className={s.divider}>{t.am ? "오전" : "오후"}</div>}
              <div className={e.id === newId ? `${s.row} pop` : s.row}>
                <div className={s.line}>
                  <span className={s.time}>
                    {t.am ? "오전" : "오후"} {t.label}
                    <Weather weather={e.weather} at={e.at} />
                  </span>
                  <button
                    className={`hand ${s.bubble} ${open || editing ? s.sel : ""}`}
                    onClick={() => stage === 0 && !connecting && setOpenId(open ? null : e.id)}
                    aria-expanded={open}
                  >
                    {e.text}
                  </button>
                </div>
                {open && (
                  <div className={s.acts}>
                    <button className={s.act} onClick={() => edit(e.id, e.text)}>
                      수정
                    </button>
                    <button className={`${s.act} ${s.del}`} onClick={() => remove(e.id)}>
                      지우기
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>

        <aside className={s.outcome} aria-label="오늘의 그림과 연결">
        <div className={s.desktopNote}>
          <span className="eyebrow">하루를 한 장으로</span>
          <h2 className="hand">작은 순간들이 모여<br />나의 그림이 돼요</h2>
          <p>{stage === 0 ? "생각난 순간을 아래 입력창에 남겨보세요. 하루를 마감하면 모은 조각들이 한 장의 그림으로 이어져요." : "남겨둔 조각과 그림의 상태를 함께 살펴보세요. 갤러리에서 이 날짜의 기록을 이어 볼 수 있어요."}</p>
          <div className={s.daySummary}><strong>{n}</strong><span>오늘 모은 조각</span></div>
        </div>
        {stage > 0 && stage < 3 && (
          <div className={`${s.drawing} pop`} aria-live="polite">
            <strong>오늘의 그림을 그리고 있어요</strong>
            {steps.map((label, i) => (
              <div key={label} className={`${s.step} ${i < stage ? s.done : i === stage ? s.now : ""}`}>
                <span className={s.stepDot}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                </span>
                {label}
              </div>
            ))}
          </div>
        )}

        {stage === 3 && art && (
          <Link href={`/gallery/${date}`} className={`${s.result} reveal`}>
            <span className={s.resultArt}>
              <Picture scene={art.scene} imageUrl={art.imageUrl} imageError={art.imageError} alt={art.summary} />
            </span>
            <span className={s.resultText}>
              <strong>오늘의 그림이 완성됐어요</strong>
              <span>자세히 보기</span>
            </span>
          </Link>
        )}
        {stage === 4 && art && (
          <Link href={`/gallery/${date}`} className={s.result}>
            <span className={s.resultText}><strong>그림을 완성하지 못했어요</strong><span>상태 확인하고 다시 시도하기</span></span>
          </Link>
        )}
        {(n > 0 || draft.trim()) && <button type="button" className="btn ghost" onClick={openConnection} disabled={connecting || requesting || !!(draft.trim() && stage > 0 && stage < 3) || !!(editingId && !draft.trim())}>
          {connecting ? "조각을 저장하고 있어요…" : draft.trim() && stage > 0 && stage < 3 ? "그림 완성 후 조각을 저장해 주세요" : draft.trim() ? "조각 저장하고 하루연결 보기" : "하루연결 · 내 기록과 닿은 뉴스"}
        </button>}
        </aside>
      </main>

      {stage === 0 && n > 0 && !editingId && (
        <div className={s.closeBar}>
          <span>하루를 마무리할까요?</span>
          <button onClick={close} disabled={connecting}>오늘 마감하고 그림 그리기</button>
        </div>
      )}

      <div className={s.composer}>
        {editingId && (
          <div className={s.editBar} role="status">
            <span>조각을 고치는 중이에요</span>
            <button onClick={cancelEdit}>취소</button>
          </div>
        )}
        {stage === 0 && !editingId && (
          <div className={s.chips} role="group" aria-label="쓸 거리 추천">
            {PROMPTS.map((q) => (
              <button
                key={q}
                className={hint === q ? `${s.chip} ${s.chipOn}` : s.chip}
                aria-pressed={hint === q}
                onClick={() => {
                  // Clicking the selected chip again clears it.
                  setHint(hint === q ? null : q);
                  input.current?.focus();
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className={s.inputRow}>
          <label htmlFor="frag" className="sr-only">
            조각글 쓰기
          </label>
          <input
            id="frag"
            ref={input}
            className={s.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) add();
              if (e.key === "Escape" && editingId) cancelEdit();
            }}
            disabled={stage > 0 || connecting}
            placeholder={
              stage > 0 ? "오늘은 마감했어요" : editingId ? "고칠 내용을 한 줄로…" : hint ? `${hint} 한 줄로…` : "생각난 걸 한 줄로…"
            }
            maxLength={140}
          />
          <button
            className={s.send}
            onClick={add}
            disabled={stage > 0 || connecting || !draft.trim()}
            aria-label={editingId ? "수정 저장" : "조각 올리기"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      <BottomNav />
    </>
  );
}
