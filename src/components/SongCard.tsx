"use client";

// The picture's song: title + channel and a "YouTube로 듣기" button, plus, on the owner's detail page,
// like / "다른 곡" buttons. Public exhibitions pass readOnly. Mock songs (MUSIC_PROVIDER=mock) have fake
// ids, so they show as text instead of a broken player.
//
// The YouTube player (privacy-enhanced domain) is added to the page only after the button is pressed.
// Until then the browser sends nothing to YouTube; the privacy policy relies on this, so do not render
// the iframe (or a YouTube thumbnail) before the press.

import { useState } from "react";
import type { Song } from "@/lib/types";
import { isMockVideo } from "@/lib/mockSong";
import s from "./SongCard.module.css";

type Props = {
  song: Song | null | undefined;
  readOnly?: boolean;
  dark?: boolean;
  busy?: boolean;
  liked?: boolean;
  note?: string | null; // e.g. "다른 곡이 아직 없어요"
  onReroll?: () => void;
  onLike?: () => void;
  onRequest?: () => void;
};

export default function SongCard({ song, readOnly, dark, busy, liked, note, onReroll, onLike, onRequest }: Props) {
  // Video id whose player was opened. A different song (다른 곡, next picture) starts closed again.
  const [opened, setOpened] = useState<string | null>(null);
  if (!song && readOnly) return null;
  const cls = dark ? `${s.card} ${s.dark}` : s.card;

  if (!song) {
    return (
      <section className={cls} aria-label="오늘의 노래">
        <h2 className={s.h}>오늘의 노래</h2>
        <p className={s.empty}>아직 노래가 없어요.</p>
        <button className="btn ghost" onClick={onRequest} disabled={busy}>
          {busy ? "찾는 중…" : "노래 추천받기"}
        </button>
      </section>
    );
  }

  const mock = isMockVideo(song.videoId);
  return (
    <section className={cls} aria-label="오늘의 노래">
      <h2 className={s.h}>오늘의 노래</h2>
      {mock ? (
        <p className={s.mock}>🎵 {song.title} (모의 곡)</p>
      ) : opened === song.videoId ? (
        <div className={s.player}>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${song.videoId}?autoplay=1`}
            title={song.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <button type="button" className={s.play} onClick={() => setOpened(song.videoId)}>
          <span aria-hidden="true">▶</span> YouTube로 듣기
        </button>
      )}
      <div className={s.meta}>
        <div className={s.text}>
          <strong className={s.title}>{song.title}</strong>
          <span className={s.channel}>
            {song.channel} · <span className={s.source}>YouTube</span>
          </span>
        </div>
        {!readOnly && (
          <div className={s.actions}>
            <button className={liked ? `${s.like} ${s.on}` : s.like} aria-label="이 노래 좋아요" aria-pressed={!!liked} onClick={onLike} disabled={busy}>
              👍
            </button>
            <button className="btn ghost" onClick={onReroll} disabled={busy}>
              {busy ? "찾는 중…" : "다른 곡"}
            </button>
          </div>
        )}
      </div>
      {note && (
        <p className={s.note} role="status">
          {note}
        </p>
      )}
    </section>
  );
}
