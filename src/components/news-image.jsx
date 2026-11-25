"use client";

import { useId, useRef, useState } from "react";
import s from "./news-image.module.css";

/** Enlarge only the stored image; the native modal keeps focus inside and handles Escape. */
export function NewsImage({ url, imageError, alt, label = "그림", onReload, boxClassName, errorClassName }) {
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [largeFailed, setLargeFailed] = useState(false);
  const dialog = useRef(null), opener = useRef(null), closeButton = useRef(null);
  const titleId = useId();
  const close = () => dialog.current?.close();
  if (!url || imageError || failed) return <div className={errorClassName}>
    <strong>그림을 불러오지 못했어요</strong><p>저장된 그림의 연결을 다시 확인해 주세요.</p>
    <button type="button" onClick={() => { setFailed(false); void onReload(); }}>다시 불러오기</button>
  </div>;
  return <>
    <button ref={opener} type="button" className={`${boxClassName} ${s.trigger}`} aria-label={`${label} 크게 보기`} aria-haspopup="dialog" onClick={() => {
      setLargeFailed(false); setExpanded(true); dialog.current.showModal(); closeButton.current?.focus();
    }}>
      {/* Signed images are displayed unchanged, without a sample-image fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      <span className={s.hint} aria-hidden="true">확대 ↗</span>
    </button>
    <dialog ref={dialog} className={s.modal} aria-labelledby={titleId} onClick={event => { if (event.target === event.currentTarget) close(); }} onClose={() => { setExpanded(false); opener.current?.focus(); }}>
      <div className={s.content}>
        <div className={s.heading}><h2 id={titleId}>{label} 크게 보기</h2><button ref={closeButton} type="button" onClick={close} aria-label="확대 화면 닫기">닫기 <span aria-hidden="true">×</span></button></div>
        {expanded && (largeFailed ? <div className={s.error} role="status"><p>그림을 불러오지 못했어요.</p><button type="button" onClick={() => { close(); void onReload(); }}>그림 다시 불러오기</button></div> : <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.largeImage} src={url} alt={alt} onError={() => setLargeFailed(true)} />
          <p className={s.caption}>{alt}</p>
        </>)}
      </div>
    </dialog>
  </>;
}
