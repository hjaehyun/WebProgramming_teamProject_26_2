"use client";

// Data layer backed by the server API (/api/auth/*, /api/me/*), which talks to Supabase. Screens only use useStore(),
// so they don't know where data lives. Writes update the screen first and then save;
// if a save fails, the user is told and the diary is reloaded from the server.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { afterPending, getCoarseCoords } from "./geo";
import { shareInflight } from "./inflight";
import type { Artwork, DB, Entry, Profile, Scene, Song, StyleId } from "./types";

/** A newly drawn picture's fields, for redrawArtwork. */
export type Redraw = {
  scene: Scene;
  style: StyleId;
  summary: string;
  tags: string[];
  summarySource?: "ai" | "fallback"; // shown only
  imagePath?: string | null; // sent
  imageUrl?: string | null; // shown
};

type Store = {
  ready: boolean;
  authed: boolean;
  /** Set when the diary couldn't be loaded (e.g. the DB is down). */
  error: string | null;
  db: DB;
  /** Both resolve with the user's diary, or throw an Error whose message can be shown. */
  signIn: (email: string, password: string) => Promise<DB>;
  signUp: (email: string, password: string) => Promise<DB>;
  signOut: () => Promise<void>;
  /** Throw an Error with a showable message, like signIn. */
  changePassword: (current: string, next: string) => Promise<void>;
  /** Email accounts confirm with their password, social accounts by typing '탈퇴'. */
  deleteAccount: (proof: { password: string } | { confirm: string }) => Promise<void>;
  setProfile: (p: Profile) => void;
  addEntry: (date: string, text: string) => Entry;
  /** Resolves once every fragment still being saved (waiting for the location) has reached the server. */
  flushEntries: () => Promise<void>;
  /** Changes a draft's text in place; its time and order stay the same. */
  editEntry: (date: string, id: string, text: string) => void;
  removeEntry: (date: string, id: string) => void;
  saveArtwork: (a: Artwork) => void;
  /** "다시 그리기": waits for the server, then shows the new picture. Throws an Error with a showable message. */
  redrawArtwork: (date: string, next: Redraw) => Promise<void>;
  /** Asks for the day's song (reroll = "다른 곡"). Throws an Error with a showable message. */
  requestSong: (date: string, reroll: boolean) => Promise<{ unchanged: boolean }>;
  /** 1 = like, -1 = skip. Throws an Error with a showable message. */
  voteSong: (songId: number, vote: 1 | -1) => Promise<void>;
  toggleExhibit: (date: string) => void;
  setExhibitPublic: (on: boolean) => void;
};

const Ctx = createContext<Store | null>(null);

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Loads the signed-in user's diary; signed out leaves an empty one. */
  const refresh = useCallback(async (): Promise<DB> => {
    try {
      const next = await api<DB>("GET", "/api/me");
      setDb(next);
      setAuthed(true);
      setError(null);
      return next;
    } catch (err) {
      const empty = createEmpty();
      setDb(empty);
      setAuthed(false);
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(err instanceof Error ? err.message : "불러오지 못했어요");
      }
      return empty;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback((fn: (d: DB) => DB) => setDb((d) => (d ? fn(d) : d)), []);

  /** Saves in the background; on failure, say so and resync with the server. */
  const save = useCallback(
    (req: Promise<unknown>) => {
      req.catch((err) => {
        console.error(err);
        alert(err instanceof Error ? err.message : "저장하지 못했어요");
        void refresh();
      });
    },
    [refresh],
  );

  // Fragment saves still waiting for the location (up to ~3s), by id: edits, deletes and closing wait for them.
  const pendingEntries = useRef(new Map<string, Promise<unknown>>());

  // One song request per day at a time (the auto request after closing vs. a quick tap on the detail page).
  const songRequests = useRef(new Map<string, Promise<{ song: Song | null; unchanged: boolean }>>());

  /** Fetches a song for the day and shows it. Not optimistic: the server picks it. */
  const requestSong = useCallback(
    async (date: string, reroll: boolean) => {
      const r = await shareInflight(songRequests.current, date, () =>
        api<{ song: Song | null; unchanged: boolean }>("POST", `/api/me/artworks/${encodeURIComponent(date)}/song`, { reroll }),
      );
      update((d) => {
        const art = d.artworks[date];
        return art ? { ...d, artworks: { ...d.artworks, [date]: { ...art, song: r.song } } } : d;
      });
      return { unchanged: r.unchanged };
    },
    [update],
  );

  const value = useMemo<Store>(() => {
    const cur = db ?? createEmpty();
    return {
      ready: db !== null,
      authed,
      error,
      db: cur,
      signIn: async (email, password) => {
        await api("POST", "/api/auth/login", { email, password });
        return refresh();
      },
      signUp: async (email, password) => {
        const res = await api<{ confirm?: boolean }>("POST", "/api/auth/signup", { email, password });
        // Supabase still requires email confirmation: no session until the link is clicked.
        if (res.confirm) throw new Error("메일함에서 인증 링크를 누른 뒤 로그인해 주세요");
        return refresh();
      },
      signOut: async () => {
        await api("POST", "/api/auth/logout").catch(console.error);
        setDb(createEmpty());
        setAuthed(false);
      },
      changePassword: async (current, next) => {
        await api("PUT", "/api/me/password", { current, next });
      },
      deleteAccount: async (proof) => {
        await api("DELETE", "/api/me", proof);
        setDb(createEmpty());
        setAuthed(false);
      },
      setProfile: (p) => {
        update((d) => ({ ...d, profile: p }));
        save(api("PUT", "/api/me/profile", p));
      },
      addEntry: (date, text) => {
        const entry: Entry = { id: crypto.randomUUID(), at: new Date().toISOString(), text };
        update((d) => ({ ...d, drafts: { ...d.drafts, [date]: [...(d.drafts[date] ?? []), entry] } }));
        // Weather needs a rough location; refused or slow (3s) -> saved without weather (specs/haru-weather.spl).
        const saving = getCoarseCoords()
          .then((c) => api("POST", "/api/me/entries", { date, entry, ...(c ?? {}) }))
          .finally(() => pendingEntries.current.delete(entry.id));
        pendingEntries.current.set(entry.id, saving);
        save(saving);
        return entry;
      },
      flushEntries: async () => {
        await Promise.allSettled([...pendingEntries.current.values()]);
      },
      editEntry: (date, id, text) => {
        update((d) => ({
          ...d,
          drafts: { ...d.drafts, [date]: (d.drafts[date] ?? []).map((e) => (e.id === id ? { ...e, text } : e)) },
        }));
        if (process.env.NODE_ENV !== "production") console.debug("[entries] edit", { date, id });
        save(afterPending(pendingEntries.current, id, () => api("PATCH", `/api/me/entries/${encodeURIComponent(id)}`, { text })));
      },
      removeEntry: (date, id) => {
        update((d) => ({ ...d, drafts: { ...d.drafts, [date]: (d.drafts[date] ?? []).filter((e) => e.id !== id) } }));
        save(afterPending(pendingEntries.current, id, () => api("DELETE", `/api/me/entries/${encodeURIComponent(id)}`)));
      },
      saveArtwork: (a) => {
        update((d) => {
          const drafts = { ...d.drafts };
          delete drafts[a.date];
          return { ...d, drafts, artworks: { ...d.artworks, [a.date]: a } };
        });
        // The server already has the day's entries; it links them to the picture by date.
        const { date, scene, style, summary, tags, mood, songQuery, imagePath } = a;
        const saved = api("POST", "/api/me/artworks", { date, scene, style, summary, tags, mood, songQuery, imagePath: imagePath ?? null });
        save(saved);
        // The song is extra: if it fails the picture is still saved, and the detail page offers a retry.
        saved.then(() => requestSong(date, false)).catch((err) => console.warn("[song]", err));
      },
      redrawArtwork: async (date, next) => {
        // Not optimistic: the old picture stays on screen until the server has the new one.
        const { scene, style, summary, tags, imagePath } = next; // summarySource/imageUrl are shown only
        await api("POST", `/api/me/artworks/${encodeURIComponent(date)}/redraw`, { scene, style, summary, tags, imagePath: imagePath ?? null });
        update((d) => {
          const old = d.artworks[date];
          return old ? { ...d, artworks: { ...d.artworks, [date]: { ...old, ...next } } } : d;
        });
      },
      requestSong,
      voteSong: async (songId, vote) => {
        await api("POST", `/api/me/songs/${songId}/feedback`, { vote });
      },
      toggleExhibit: (date) => {
        const has = cur.exhibition.dates.includes(date);
        const dates = has ? cur.exhibition.dates.filter((x) => x !== date) : [...cur.exhibition.dates, date];
        update((d) => ({ ...d, exhibition: { ...d.exhibition, dates } }));
        save(api("PATCH", "/api/me/exhibition", { dates }));
      },
      setExhibitPublic: (on) => {
        update((d) => ({ ...d, exhibition: { ...d.exhibition, isPublic: on } }));
        save(api("PATCH", "/api/me/exhibition", { isPublic: on }));
      },
    };
  }, [db, authed, error, refresh, update, save, requestSong]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function createEmpty(): DB {
  return { account: null, profile: null, drafts: {}, artworks: {}, exhibition: { id: "", title: "", desc: "", isPublic: false, dates: [] } };
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

export function byTime(a: Entry, b: Entry): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

export function sortedArtworks(db: DB): Artwork[] {
  return Object.values(db.artworks).sort((a, b) => (a.date < b.date ? 1 : -1));
}
