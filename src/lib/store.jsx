"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getCoarseCoords } from "./geo";
import { shareInflight } from "./inflight";
import { createMutationQueue } from "./mutation-queue";
import { createFrameWrites } from "./frame-writes";
import { createSnapshotSync } from "./snapshot-sync";
import { nextExhibitionDates } from "./exhibition-selection";
import { todayKey } from "./date";

const Ctx = createContext(null);
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function api(method, url, body) {
  const res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "요청을 완료하지 못했어요.");
  return data;
}
// A day's fragments live in drafts until the day has a picture, then in that picture's entries.
// Changing a pictured day marks it changed at once; the next dashboard read has the server's verdict.
function withEntries(d, date, fn) {
  const a = d.artworks[date];
  if (a) return { ...d, artworks: { ...d.artworks, [date]: { ...a, entries: fn(a.entries), entriesChanged: true } } };
  return { ...d, drafts: { ...d.drafts, [date]: fn(d.drafts[date] ?? []) } };
}
const sendFrame = (date, frame) => api("PUT", `/api/me/artworks/${encodeURIComponent(date)}/frame`, { frame });
function createEmpty() {
  return { account: null, profile: null, drafts: {}, artworks: {}, exhibition: { id: "", title: "나의 하루조각", desc: "", isPublic: false, dates: [] }, capabilities: { music: false, weather: false }, deletionPending: false };
}
export function StoreProvider({ children }) {
  const [db, setDb] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState(null);
  // Unsubmitted historical-day text lives only in this login session. Route
  // changes (including browser Back) may unmount its page without losing it.
  const [journalComposers, setJournalComposers] = useState({});
  const sessionVersion = useRef(0);
  const sessionAccountId = useRef(null);
  const snapshotSync = useRef(createSnapshotSync());
  const pendingEntries = useRef(createMutationQueue());
  const songRequests = useRef(new Map());
  const frameWrites = useRef(createFrameWrites(sendFrame));
  const exhibitionRequest = useRef(false);
  const [exhibitionSaving, setExhibitionSaving] = useState(false);
  const newSession = useCallback(() => {
    sessionVersion.current++;
    sessionAccountId.current = null;
    setJournalComposers({});
    snapshotSync.current = createSnapshotSync();
    pendingEntries.current = createMutationQueue();
    songRequests.current = new Map();
    frameWrites.current = createFrameWrites(sendFrame);
    exhibitionRequest.current = false;
    setExhibitionSaving(false);
  }, []);
  const hasJournalDraft = Object.values(journalComposers).some(value => value.draft || value.editingId || value.saving);
  useEffect(() => {
    if (!hasJournalDraft) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasJournalDraft]);
  const refresh = useCallback(async (throwOnError = false) => {
    const version = sessionVersion.current;
    const sync = snapshotSync.current;
    try {
      const next = await sync.read(() => api("GET", "/api/me"), next => {
        if (version !== sessionVersion.current) return;
        // A different tab can change the auth cookie without calling signIn here.
        // Retire all old-account drafts and async callbacks before showing it.
        const nextAccountId = next.account?.id ?? null;
        if (sessionAccountId.current && sessionAccountId.current !== nextAccountId) newSession();
        sessionAccountId.current = nextAccountId;
        // This snapshot was fetched after all pending entry writes settled.
        // A failed optimistic note is now gone from the authoritative UI, so it
        // must not permanently block later closing of successfully saved notes.
        pendingEntries.current.acknowledgeFailures();
        setDb(next); setAuthed(true); setError(null);
      });
      if (version !== sessionVersion.current) return createEmpty();
      return next;
    } catch (err) {
      if (version !== sessionVersion.current) return createEmpty();
      if (err instanceof ApiError && err.status === 401) { newSession(); setDb(createEmpty()); setAuthed(false); setError(null); }
      else { setDb(d => d ?? createEmpty()); setError(err.message); }
      if (throwOnError) throw err;
      return null;
    }
  }, [newSession]);
  // refresh awaits the HTTP response before it updates React state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  const processing = Object.values(db?.artworks ?? {}).some(a => ["queued", "processing"].includes(a.status));
  useEffect(() => {
    if (!authed || !processing) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [authed, processing, refresh]);
  useEffect(() => {
    if (!authed) return;
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [authed, refresh]);
  const update = useCallback(fn => {
    snapshotSync.current.changed();
    setDb(d => d ? fn(d) : d);
  }, []);
  const trackWrite = useCallback(async operation => {
    const finish = snapshotSync.current.beginWrite();
    try { return await operation(); }
    finally { finish(); }
  }, []);
  const saveExhibition = useCallback(async patch => {
    if (exhibitionRequest.current) return;
    const token = {};
    const version = sessionVersion.current;
    exhibitionRequest.current = token;
    setExhibitionSaving(true);
    try {
      // End the write before refreshing, otherwise refresh would wait on itself.
      await trackWrite(() => api("PATCH", "/api/me/exhibition", patch));
      if (version === sessionVersion.current) await refresh(true);
    }
    finally { if (exhibitionRequest.current === token) { exhibitionRequest.current = false; setExhibitionSaving(false); } }
  }, [refresh, trackWrite]);
  const report = useCallback(promise => {
    const version = sessionVersion.current;
    promise.catch(err => {
      if (version !== sessionVersion.current) return;
      alert(err instanceof Error ? err.message : "저장하지 못했어요."); void refresh();
    });
  }, [refresh]);
  const applyArtwork = useCallback(a => {
    update(d => { const drafts = { ...d.drafts }; delete drafts[a.date]; return { ...d, drafts, artworks: { ...d.artworks, [a.date]: a } }; });
  }, [update]);
  const requestSong = useCallback(async (date, reroll) => {
    const version = sessionVersion.current;
    const r = await shareInflight(songRequests.current, date, () => trackWrite(() => api("POST", `/api/me/artworks/${encodeURIComponent(date)}/song`, { reroll })));
    if (version === sessionVersion.current) update(d => { const a = d.artworks[date]; return a ? { ...d, artworks: { ...d.artworks, [date]: { ...a, song: r.song } } } : d; });
    return { unchanged: r.unchanged, song: r.song };
  }, [update, trackWrite]);
  const value = useMemo(() => {
    const cur = db ?? createEmpty();
    const version = sessionVersion.current;
    const updateThisSession = fn => { if (version === sessionVersion.current) update(fn); };
    const requireThisSession = () => { if (version !== sessionVersion.current) throw new Error("로그인 상태가 바뀌었어요. 다시 확인해 주세요."); };
    // Each fragment's writes are serialized; errors are reported (alert + refresh) by report().
    // A pictured day is re-read after a successful write: entriesChanged, or the picture being gone.
    const writeEntry = (date, id, operation) => {
      const pictured = !!cur.artworks[date];
      const saving = trackWrite(() => pendingEntries.current.enqueue(id, async () => { requireThisSession(); return operation(); }));
      report(saving);
      if (pictured) saving.then(() => { if (version === sessionVersion.current) void refresh(); }, () => {});
      return saving;
    };
    return {
      ready: db !== null, authed, error, db: cur, refresh, exhibitionSaving, journalComposers,
      isCurrentSession: () => version === sessionVersion.current,
      setJournalComposer: (date, patch) => {
        if (version !== sessionVersion.current) return;
        setJournalComposers(previous => {
          const next = { ...previous };
          if (patch === null) delete next[date];
          else next[date] = { ...previous[date], ...patch };
          return next;
        });
      },
      applyArtwork: a => { if (version === sessionVersion.current) applyArtwork(a); },
      signIn: async (email, password) => { await api("POST", "/api/auth/login", { email, password }); newSession(); return refresh(true); },
      signUp: async (email, password) => {
        const r = await api("POST", "/api/auth/signup", { email, password });
        if (r.confirm) return { confirmationRequired: true };
        newSession(); return { ...await refresh(true), confirmationRequired: false };
      },
      signOut: async () => {
        await api("POST", "/api/auth/logout"); newSession();
        setDb(createEmpty()); setAuthed(false); setError(null);
      },
      changePassword: async (current, next) => { await api("PUT", "/api/me/password", { current, next }); },
      deleteAccount: async proof => {
        try { await trackWrite(() => api("DELETE", "/api/me", proof)); }
        catch (e) { await refresh(); throw e; }
        newSession(); setDb(createEmpty()); setAuthed(false); setError(null);
      },
      setProfile: async p => { requireThisSession(); await trackWrite(() => api("PUT", "/api/me/profile", p)); updateThisSession(d => ({ ...d, profile: p })); },
      /** Today or any past day; a day without a picture keeps its entries in drafts. */
      addEntry: (date, text) => {
        const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), text };
        update(d => withEntries(d, date, list => [...list, entry]));
        writeEntry(date, entry.id, async () => {
          // The weather right now only describes a fragment written today.
          const coords = cur.capabilities?.weather && date === todayKey() ? await getCoarseCoords() : null;
          requireThisSession();
          const r = await api("POST", "/api/me/entries", { date, entry, ...(coords ?? {}) });
          updateThisSession(d => withEntries(d, date, list => list.map(e => e.id === entry.id ? { ...r.entry, text: e.text === entry.text ? r.entry.text : e.text } : e)));
        });
        return entry;
      },
      flushEntries: () => pendingEntries.current.flush(),
      editEntry: (date, id, text) => {
        update(d => withEntries(d, date, list => list.map(e => e.id === id ? { ...e, text } : e)));
        return writeEntry(date, id, () => api("PATCH", `/api/me/entries/${encodeURIComponent(id)}`, { text }));
      },
      /** Resolves to { artworkRemoved }: true when the day's last fragment took its picture with it. */
      removeEntry: (date, id) => {
        update(d => withEntries(d, date, list => list.filter(e => e.id !== id)));
        return writeEntry(date, id, () => api("DELETE", `/api/me/entries/${encodeURIComponent(id)}`));
      },
      requestSong,
      /** Shows the frame at once; changes for one day are sent in order and a failure reloads the server's choice. */
      setFrame: (date, frame) => {
        update(d => { const a = d.artworks[date]; return a ? { ...d, artworks: { ...d.artworks, [date]: { ...a, frame } } } : d; });
        const saving = trackWrite(() => frameWrites.current.write(date, frame));
        report(saving);
        return saving;
      },
      voteSong: async (songId, vote) => { await api("POST", `/api/me/songs/${songId}/feedback`, { vote }); },
      toggleExhibit: date => {
        const dates = nextExhibitionDates(cur.exhibition.dates, cur.artworks, date);
        report(saveExhibition({ dates }));
      },
      setExhibitPublic: on => { report(saveExhibition({ isPublic: on })); },
    };
  }, [db, authed, error, refresh, update, report, requestSong, applyArtwork, exhibitionSaving, saveExhibition, newSession, trackWrite, journalComposers]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore() { const s = useContext(Ctx); if (!s) throw new Error("useStore must be used inside StoreProvider"); return s; }
export function byTime(a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }
export function sortedArtworks(db) { return Object.values(db.artworks).sort((a, b) => a.date < b.date ? 1 : -1); }
