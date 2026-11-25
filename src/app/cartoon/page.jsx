"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { BottomNav, IconNext, ProfileButton, Screen, TopBar } from "@/components/ui";
import { longDate } from "@/lib/date";
import { useStore } from "@/lib/store";
import { useEdition, validCartoonDate as validDate } from "@/lib/cartoon-client";
import { useJournalToday } from "@/lib/use-journal-today";
import s from "./cartoon.module.css";

const pending = cartoon => cartoon && ["queued", "processing"].includes(cartoon.status);
function sourceUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function timestamp(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : null;
}

export default function CartoonPage() {
  return (
    <Screen>
      <Suspense fallback={<div className="loading">만평 지면을 펼치고 있어요…</div>}>
        <CartoonRoute />
      </Suspense>
    </Screen>
  );
}

function CartoonRoute() {
  const params = useSearchParams();
  const today = useJournalToday();
  const date = params.has("date") ? params.get("date") : today;
  const autoRequested = useRef(new Set());
  if (!validDate(date) || date > today) return <>
    <TopBar title="날짜 확인" back="/cartoon" />
    <div className={s.invalid}><h2>오늘까지의 날짜를 골라 주세요</h2><p>유효한 지난 날짜나 오늘 날짜로 만평을 펼칠 수 있어요.</p><Link href="/cartoon">오늘의 만평으로 돌아가기</Link></div>
  </>;
  return <Edition key={date} requestedDate={date} today={today} autoRequested={autoRequested} />;
}

function Edition({ requestedDate, today, autoRequested }) {
  const router = useRouter();
  const { db, refresh: refreshPersonal } = useStore();
  const { payload, error, loading, posting, fetchedAt, refresh, start } = useEdition(requestedDate, autoRequested);
  const [mode, setMode] = useState("both");
  const [pickerDate, setPickerDate] = useState(requestedDate);
  const date = requestedDate;
  const cartoon = payload?.cartoon?.date === date ? payload.cartoon : null;
  const personal = db.artworks[date];
  const dates = [...new Set(payload?.dates ?? [])].filter(day => validDate(day) && day <= today).sort().reverse();
  const canRequest = date <= today && payload?.enabled && payload?.canRequest;
  const chooseDate = day => { if (validDate(day) && day <= today) router.replace(`/cartoon?date=${encodeURIComponent(day)}`, { scroll: false }); };
  const sources = (cartoon?.sources ?? []).map(source => ({ ...source, href: sourceUrl(source.url) })).filter(source => source.href);
  const selectedAt = timestamp(cartoon?.selectedAt);
  const comparing = mode === "both";

  return (
    <>
      <main className={`scroll ${s.paper}`}>
        <header className={s.masthead}>
          <div className={s.nameplate}><span>HARU DAILY</span><span>하루조각의 작은 신문</span></div>
          <div className={s.titleRow}><h1>하루만평<span className={s.titleDot}>.</span></h1><ProfileButton /></div>
          <p className={s.dek}>나의 하루와 세상의 하루,<br />같은 날짜의 두 장면을 펼쳐보세요.</p>
          <nav className={s.sections} aria-label="뉴스 그림 메뉴">
            <Link href={`/cartoon?date=${date}`} aria-current="page">하루만평 <span>함께 보는 뉴스</span></Link>
            <Link href={`/connection?date=${date}`}>하루연결 <span>내 기록과 닿은 뉴스</span></Link>
          </nav>
          <div className={s.editionRow}>
            <span className={s.editionTag}><i aria-hidden="true" />하루 한 장 · 함께 보는 만평</span>
            <form className={s.dateForm} onSubmit={event => { event.preventDefault(); chooseDate(pickerDate); }}>
              <label className={s.datePicker} htmlFor="cartoon-date"><span>만평 날짜</span>
                <input id="cartoon-date" type="date" min="0001-01-01" max={today} required value={pickerDate} onChange={event => setPickerDate(event.target.value)} />
              </label>
              <button type="submit" disabled={!validDate(pickerDate) || pickerDate > today}>이날 보기</button>
            </form>
            <p className={s.dateHelp}>지난 날짜도 골라 그날의 뉴스로 만평을 만들 수 있어요. 날짜마다 한 장을 함께 봐요.</p>
            <label className={s.archivePicker}><span>저장된 만평</span>
              <select value={dates.includes(date) ? date : ""} onChange={event => chooseDate(event.target.value)}>
                <option value="" disabled>{dates.length ? "저장된 날짜 선택" : "아직 저장된 만평이 없어요"}</option>
                {dates.map(day => <option key={day} value={day}>{day.slice(0, 4)}년 {longDate(day)}{day === today ? " · 오늘" : ""}</option>)}
              </select>
            </label>
          </div>
        </header>

        {error && <div className={s.notice} role="alert"><p>{error}</p><button onClick={refresh}>다시 불러오기</button></div>}

        <section className={s.lead} aria-labelledby="news-title">
          <div className={s.kicker}><span>01 / 세상의 하루</span><span>{date === today ? "오늘의 대표 뉴스" : "이날의 대표 뉴스"}</span></div>
          <h2 id="news-title">{cartoon?.headline || (loading ? "이날의 이야기를 불러오는 중" : pending(cartoon) || posting ? "이날을 담을 한 장면을 찾고 있어요" : "하루를 읽는 또 하나의 시선")}</h2>
          <p className={s.leadNote}>{date === today ? "오늘은 저녁 7시 이후, 선정 시각까지 나온 보도에서 대표 뉴스 한 가지를 골라요." : "선택한 날짜에 나온 보도를 한국 시간 하루 기준으로 살펴 대표 뉴스 한 가지를 만평으로 풀어내요."}</p>
        </section>

        <div className={s.viewModes} role="group" aria-label="그림 보기 방식">
          {[["both", "두 장면 비교"], ["cartoon", "하루만평"], ["personal", "내 하루"]].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? s.activeMode : ""} onClick={() => setMode(value)}>{label}</button>
          ))}
        </div>

        <div className={`${s.pictures} ${comparing ? s.comparing : ""}`}>
          {mode !== "personal" && <figure className={s.picturePanel}>
            <div className={s.panelHeading}><span className={s.panelNumber}>01</span><h3>세상의 하루</h3><span className={s.aiTag}>AI 만평</span></div>
            {cartoon?.status === "ready" ? (
              <EditionImage key={cartoon.imageUrl} url={cartoon.imageUrl} imageError={cartoon.imageError} alt={cartoon.caption || cartoon.headline || "이날의 AI 만평"} onReload={refresh} />
            ) : <CartoonStatus cartoon={cartoon} loading={loading} posting={posting} enabled={payload?.enabled} beforeAvailable={new Date(payload?.availableAt).getTime() > fetchedAt} isToday={date === today} canRequest={canRequest} onRequest={start} />}
            <figcaption>{longDate(date)}<span>뉴스에서 출발한 비유</span></figcaption>
          </figure>}

          {mode !== "cartoon" && <figure className={`${s.picturePanel} ${s.personalPanel}`}>
            <div className={s.panelHeading}><span className={s.panelNumber}>02</span><h3>나의 하루</h3><span className={s.privateTag}>나만 보기</span></div>
            {personal?.status === "ready" ? (
              <EditionImage key={personal.imageUrl} url={personal.imageUrl} imageError={personal.imageError} alt={personal.summary || "내가 남긴 이날의 그림"} onReload={refreshPersonal} />
            ) : <div className={s.emptyPicture}>
              <span className={s.emptyMark} aria-hidden="true">✦</span>
              <strong>{pending(personal) ? "내 그림을 그리고 있어요" : personal?.status === "failed" ? "내 그림을 완성하지 못했어요" : "아직 나의 그림이 없어요"}</strong>
              <p>{personal ? "갤러리에서 그림 상태를 확인해 주세요." : "이날의 작은 순간도 한 장의 그림으로 남겨보세요."}</p>
              <Link href={date === today && !personal ? "/today" : `/gallery/${date}`}>{personal ? "그림 확인하기" : date === today ? "오늘 기록하기" : "이날 기록하기"}<IconNext /></Link>
            </div>}
            <figcaption>{longDate(date)}<span>내가 남긴 순간의 기록</span></figcaption>
            {personal?.status === "ready" && <Link className={s.personalLink} href={`/gallery/${date}`}>내 그림 자세히 보기 <IconNext /></Link>}
          </figure>}
        </div>

        <p className={s.comparisonNote}>만평은 사회의 사건을 비유로, 내 그림은 기록한 순간을 담아요. 같은 날의 두 장면은 어떤 분위기로 기억되나요?</p>

        {cartoon?.headline && <section className={s.article} aria-label="뉴스와 만평 읽기">
          <div className={s.articleBlock}><h3><span className={s.sectionIndex}>A</span>뉴스 요약 <small>보도된 사실</small></h3><p>{cartoon.summary || "뉴스 요약을 정리하고 있어요."}</p></div>
          {cartoon.caption && <div className={`${s.articleBlock} ${s.captionBlock}`}><h3><span className={s.sectionIndex}>B</span>만평 해설 <small>그림 속 비유</small></h3><p>{cartoon.caption}</p></div>}
          <div className={s.selection}><h3>이 뉴스를 고른 이유</h3><p>{cartoon.selectionReason || "선정 이유를 정리하고 있어요."}</p>{selectedAt && <time dateTime={cartoon.selectedAt}>선정 · {selectedAt} (한국 시간)</time>}</div>
        </section>}

        {sources.length > 0 && <section className={s.sources} aria-labelledby="sources-title">
          <h3 id="sources-title">원문으로 더 읽기<span>{sources.length}개 출처</span></h3>
          <ol>{sources.map((source, index) => <li key={`${source.href}-${index}`}>
            <a href={source.href} target="_blank" rel="noopener noreferrer"><span className={s.sourceMeta}>{source.publisher || "원문 보도"}{timestamp(source.publishedAt) && <> · {timestamp(source.publishedAt)}</>}</span><span className={s.sourceTitle}>{source.title}<span aria-hidden="true">↗</span></span></a>
          </li>)}</ol>
        </section>}

        <footer className={s.colophon}><strong>하루조각 · 하루만평</strong><p>같은 날짜의 만평 한 장을 모두가 함께 봐요.<br />뉴스를 바탕으로 AI가 만든 비유이며 실제 장면의 재현은 아니에요.<br />사실관계와 자세한 맥락은 원문 보도를 함께 확인해 주세요.</p></footer>
      </main>
      <BottomNav />
    </>
  );
}

function EditionImage({ url, imageError, alt, onReload }) {
  const [failed, setFailed] = useState(false);
  if (!url || imageError || failed) return <div className={s.emptyPicture}><strong>그림을 불러오지 못했어요</strong><p>이미지 연결을 다시 확인해 주세요.</p><button onClick={() => { setFailed(false); void onReload(); }}>다시 불러오기</button></div>;
  // Signed images are displayed unchanged; an absent image never falls back to example artwork.
  // eslint-disable-next-line @next/next/no-img-element
  return <div className={s.imageBox}><img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} /></div>;
}

function CartoonStatus({ cartoon, loading, posting, enabled, beforeAvailable, isToday, canRequest, onRequest }) {
  const working = posting || pending(cartoon);
  const drawing = cartoon?.stage === "drawing";
  let title = "이날은 발행된 만평이 없어요", detail = "다른 날짜의 지면도 펼쳐보세요.";
  if (loading) { title = "지면을 펼치고 있어요"; detail = "잠시만 기다려 주세요."; }
  else if (working) { title = drawing ? "만평 한 장을 그리고 있어요" : "대표 뉴스를 살펴보고 있어요"; detail = "완성되면 이 자리에 보여드릴게요."; }
  else if (cartoon?.status === "failed") { title = `${isToday ? "오늘" : "이날"}의 만평을 완성하지 못했어요`; detail = cartoon.error || "잠시 후 다시 확인해 주세요."; }
  else if (cartoon?.status === "unavailable") { title = "선정할 뉴스를 확인하지 못했어요"; detail = cartoon.error || "확인할 수 있는 보도가 모이면 다시 준비할 수 있어요."; }
  else if (!enabled) { title = "하루만평을 준비하고 있어요"; detail = "새로운 지면이 열리면 이곳에서 만나요."; }
  else if (isToday && beforeAvailable) { title = "저녁 7시 이후에 만나요"; detail = "하루의 보도가 모이면 오늘의 대표 뉴스와 만평을 준비해요."; }
  else if (isToday) { title = "오늘의 지면을 준비해요"; detail = "대표 뉴스 한 가지를 골라 모두가 함께 볼 만평을 만들어요."; }
  else if (canRequest) { title = "이날의 만평을 만들어 보세요"; detail = "버튼을 누르면 선택한 날짜의 보도에서 대표 뉴스를 찾아 만평을 만들어요."; }
  return <div className={`${s.emptyPicture} ${working ? s.working : ""}`} role="status" aria-live="polite">
    <span className={s.emptyMark} aria-hidden="true">{working ? "◎" : "✳"}</span><strong>{title}</strong><p>{detail}</p>
    {working && <div className={s.progress}><span className={!drawing ? s.currentStep : ""}>뉴스 선정</span><i aria-hidden="true" /><span className={drawing ? s.currentStep : ""}>만평 그리기</span></div>}
    {!posting && !loading && canRequest && <button onClick={onRequest}>{cartoon ? "다시 시도하기" : isToday ? "오늘의 만평 준비하기" : "이날의 만평 준비하기"}</button>}
  </div>;
}
