"use client";

// Trash: deleted fragments, and pictures that went with a day's last fragment, wait here for
// TRASH_DAYS days. Restore puts them back on their day; permanent deletion cannot be undone.

import { useCallback, useEffect, useState } from "react";
import Picture from "@/components/Picture";
import { BottomNav, Screen, TopBar } from "@/components/ui";
import { longDate } from "@/lib/date";
import { useStore } from "@/lib/store";
import { TRASH_DAYS, daysLeft, emptyTrash, fetchTrash, purgeTrash, restoreTrash, trashView } from "@/lib/trash";
import s from "./trash.module.css";

export default function TrashPage() {
  return (
    <Screen>
      <Trash />
    </Screen>
  );
}

function restoredNote(r) {
  if (r.restored === "entry_only") return `${longDate(r.date)}에는 다른 그림이 있어서 조각만 되살렸어요. 그림은 휴지통에 남아 있어요.`;
  if (r.restored === "artwork") return `${longDate(r.date)}의 그림과 조각을 되살렸어요. 전시회와 노래는 다시 골라 주세요.`;
  return `${longDate(r.date)}의 조각을 되살렸어요.`;
}

function Trash() {
  const { refresh } = useStore();
  const [items, setItems] = useState(null); // null until the first load
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // an item id, or "all"
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchTrash());
      setError(null);
    } catch (e) {
      // Keep what was shown (or nothing): a failed load must not look like an empty trash.
      setError(e instanceof Error ? e.message : "휴지통을 불러오지 못했어요.");
    }
  }, []);
  // load awaits the HTTP response before it updates React state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function work(key, action) {
    if (busy) return;
    setBusy(key);
    setNote(null);
    try {
      await action();
    } catch (e) {
      alert(e instanceof Error ? e.message : "요청을 완료하지 못했어요.");
    } finally {
      await load();
      setBusy(null);
    }
  }

  const view = trashView(items, error);
  const restore = (item) => work(item.id, async () => {
    const r = await restoreTrash(item.id);
    setNote(restoredNote(r));
    await refresh();
  });
  const purge = (item) => {
    if (!confirm(`${longDate(item.date)}의 ${item.kind === "artwork" ? "그림과 조각" : "조각"}을 완전히 지울까요?\n되돌릴 수 없어요.`)) return;
    void work(item.id, () => purgeTrash(item.id));
  };
  const empty = () => {
    if (!confirm("휴지통을 비울까요?\n모든 항목이 완전히 지워지고 되돌릴 수 없어요.")) return;
    void work("all", emptyTrash);
  };

  return (
    <>
      <TopBar title="휴지통" back="/me" />
      <main className={`scroll ${s.main}`}>
        <p className={s.intro}>지운 조각과 함께 지워진 그림은 {TRASH_DAYS}일 동안 여기 있어요. 그 뒤에는 자동으로 완전히 지워져요.</p>
        {note && <p className={s.note} role="status">{note}</p>}
        {error && view !== "error" && <p className={s.error} role="alert">{error}</p>}

        {view === "loading" ? (
          <div className="loading">불러오는 중…</div>
        ) : view === "error" ? (
          <div className={s.empty} role="alert">
            <strong>휴지통을 불러오지 못했어요</strong>
            <span>{error}</span>
            <button type="button" className={s.restore} onClick={() => void load()}>다시 시도</button>
          </div>
        ) : view === "empty" ? (
          <div className={s.empty}>
            <strong>휴지통이 비어 있어요</strong>
            <span>조각을 지우면 여기서 {TRASH_DAYS}일 안에 되살릴 수 있어요.</span>
          </div>
        ) : (
          <>
            <div className={s.head}>
              <h2>{items.length}개</h2>
              <button type="button" className={s.emptyBtn} onClick={empty} disabled={!!busy}>
                {busy === "all" ? "비우는 중…" : "휴지통 비우기"}
              </button>
            </div>
            <ul className={s.list}>
              {items.map((item) => {
                const days = daysLeft(item.purgeAt);
                return (
                  <li key={`${item.kind}-${item.id}`} className={item.kind === "artwork" ? `${s.item} ${s.withThumb}` : s.item}>
                    {item.kind === "artwork" && (
                      <span className={s.thumb}>
                        <Picture scene={item.scene} imageUrl={item.imageUrl} alt={`${longDate(item.date)}의 그림`} />
                      </span>
                    )}
                    <div className={s.body}>
                      <strong>{longDate(item.date)}</strong>
                      {item.kind === "artwork" ? (
                        <>
                          <span className={s.kind}>그림{item.entries.length ? ` · 함께 지운 조각 ${item.entries.length}개` : ""}</span>
                          {item.entries.map((text, i) => <p key={i} className={`hand ${s.text}`}>{text}</p>)}
                        </>
                      ) : (
                        <p className={`hand ${s.text}`}>{item.text}</p>
                      )}
                      <span className={s.days}>{days > 0 ? `${days}일 뒤 완전 삭제` : "곧 완전 삭제"}</span>
                    </div>
                    <div className={s.actions}>
                      <button type="button" className={s.restore} onClick={() => restore(item)} disabled={!!busy}
                        aria-label={`${longDate(item.date)} ${item.kind === "artwork" ? "그림" : "조각"} 되살리기`}>
                        {busy === item.id ? "처리 중…" : "되살리기"}
                      </button>
                      <button type="button" className={s.purge} onClick={() => purge(item)} disabled={!!busy}
                        aria-label={`${longDate(item.date)} ${item.kind === "artwork" ? "그림" : "조각"} 완전 삭제`}>
                        완전 삭제
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
      <BottomNav />
    </>
  );
}
