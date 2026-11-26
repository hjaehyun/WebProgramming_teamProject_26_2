"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { BottomNav, IconNext, ProfileButton, Screen, TopBar } from "@/components/ui";
import { NewsImage } from "@/components/news-image";
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
function broadcastEvidence(source, date) {
  const evidence = source.prominence;
  if (!evidence || evidence.kind !== "broadcast_running_order" || evidence.editionDate !== date
    || !Number.isInteger(evidence.rank) || evidence.rank < 1 || evidence.rank > 3 || typeof evidence.url !== "string") return null;
  try {
    const url = new URL(evidence.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || /[\\\s]/.test(evidence.url)) return null;
    if (evidence.program === "SBS 8뉴스") {
      const keys = [...url.searchParams.keys()];
      if (source.publisher !== "SBS" || url.hostname !== "news.sbs.co.kr" || url.pathname !== "/news/programMain.do"
        || keys.length !== 2 || keys.some(key => !["broad_date", "prog_cd"].includes(key))
        || url.searchParams.get("broad_date") !== date.replaceAll("-", "") || url.searchParams.get("prog_cd") !== "R1") return null;
    } else if (evidence.program === "MBC 뉴스데스크") {
      if (source.publisher !== "MBC" || url.hostname !== "imnews.imbc.com" || url.search
        || !new RegExp(`^/replay/${date.slice(0, 4)}/nwdesk/[0-9]+_[0-9]+\\.html$`).test(url.pathname)) return null;
    } else return null;
    return { url: url.href, label: `${evidence.program} 기사 목록 · ${["첫 번째", "두 번째", "세 번째"][evidence.rank - 1]} 보도` };
  } catch { return null; }
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
  const sources = (cartoon?.sources ?? []).map(source => ({ ...source, href: sourceUrl(source.url), broadcast: broadcastEvidence(source, date) })).filter(source => source.href);
  const selectedAt = timestamp(cartoon?.selectedAt);
  const comparing = mode === "both";
  const ready = cartoon?.status === "ready";
  const primarySource = sources[0];

  return (
    <>
      <main className={`scroll ${s.paper}`}>
        <header className={s.masthead}>
          <div className={s.nameplate}><span>하루세상</span><span>하루조각의 작은 신문</span></div>
          <div className={s.titleRow}><h1>하루만평<span className={s.titleDot}>.</span></h1><ProfileButton /></div>
          {!ready && <p className={s.dek}>나의 하루와 세상의 하루,<br />같은 날짜의 두 장면을 펼쳐보세요.</p>}
          <nav className={s.sections} aria-label="하루세상 메뉴">
            <Link href={`/cartoon?date=${date}`} aria-current="page">하루만평 <span>함께 보는 뉴스</span></Link>
            <Link href={`/connection?date=${date}`}>하루연결 <span>내 기록과 닿은 뉴스</span></Link>
          </nav>
          <div className={s.editionRow}>
            <span className={s.editionTag}><i aria-hidden="true" />하루 한 장 · 함께 보는 만평</span>
            <form className={s.dateForm} onSubmit={event => { event.preventDefault(); chooseDate(pickerDate); }}>
              <label className={s.datePicker} htmlFor="cartoon-date"><span>만평 날짜</span>
                <input id="cartoon-date" type="date" min="0001-01-01" max={today} required value={pickerDate} onChange={event => setPickerDate(event.target.value)} />
              </label>
              <button type="submit" disabled={!validDate(pickerDate) || pickerDate > today}>보기</button><button type="button" onClick={() => chooseDate(today)} disabled={date === today}>오늘</button>
            </form>
            {!ready && <p className={s.dateHelp}>지난 날짜도 그날의 뉴스로 만평을 만들 수 있어요.</p>}
            <details className={s.archive}><summary>저장된 만평 {dates.length > 0 && <span>{dates.length}일</span>}</summary><label className={s.archivePicker}><span>저장된 날짜 선택</span>
              <select value={dates.includes(date) ? date : ""} onChange={event => chooseDate(event.target.value)}>
                <option value="" disabled>{dates.length ? "저장된 날짜 선택" : "아직 저장된 만평이 없어요"}</option>
                {dates.map(day => <option key={day} value={day}>{day.slice(0, 4)}년 {longDate(day)}{day === today ? " · 오늘" : ""}</option>)}
              </select>
            </label></details>
          </div>
        </header>

        {error && <div className={s.notice} role="alert"><p>{error}</p><button onClick={refresh}>다시 불러오기</button></div>}

        <section className={s.lead} aria-labelledby="news-title">
          <div className={s.kicker}><span>01 / 세상의 하루</span><span>{date === today ? "오늘의 대표 뉴스" : "이날의 대표 뉴스"}</span></div>
          <h2 id="news-title">{cartoon?.headline || (loading ? "이날의 이야기를 불러오는 중" : pending(cartoon) || posting ? "이날을 담을 한 장면을 찾고 있어요" : "하루를 읽는 또 하나의 시선")}</h2>
          {!ready && <p className={s.leadNote}>{date === today ? "오늘은 밤 10시 이후, 저녁 뉴스의 선두 기사에서 대표 사건을 골라요." : "선택한 날짜에 나온 보도 중 저녁 뉴스의 선두 기사를 살펴 대표 사건을 골라요."} 같은 사건을 독립 매체 두 곳 이상에서 확인하고, 근거가 부족하면 다른 기사로 대신 채우지 않아요.</p>}
          {primarySource && <a className={s.primarySource} href={primarySource.href} target="_blank" rel="noopener noreferrer"><span>{primarySource.publisher || "대표 출처"}{timestamp(primarySource.publishedAt) && ` · ${timestamp(primarySource.publishedAt)}`}</span><strong>원문 보기 ↗</strong></a>}
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
              <NewsImage key={cartoon.imageUrl} url={cartoon.imageUrl} imageError={cartoon.imageError} alt={cartoon.caption || cartoon.headline || "이날의 AI 만평"} label="하루만평" onReload={refresh} boxClassName={s.imageBox} errorClassName={s.emptyPicture} />
            ) : <CartoonStatus cartoon={cartoon} loading={loading} posting={posting} enabled={payload?.enabled} beforeAvailable={new Date(payload?.availableAt).getTime() > fetchedAt} isToday={date === today} canRequest={canRequest} onRequest={start} />}
            <figcaption>{longDate(date)}<span>뉴스에서 출발한 비유</span></figcaption>
          </figure>}

          {mode !== "cartoon" && <figure className={`${s.picturePanel} ${s.personalPanel}`}>
            <div className={s.panelHeading}><span className={s.panelNumber}>02</span><h3>나의 하루</h3><span className={s.privateTag}>나만 보기</span></div>
            {personal?.status === "ready" ? (
              <NewsImage key={personal.imageUrl} url={personal.imageUrl} imageError={personal.imageError} alt={personal.summary || "내가 남긴 이날의 그림"} label="내 하루 그림" onReload={refreshPersonal} boxClassName={s.imageBox} errorClassName={s.emptyPicture} />
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
            <div className={s.sourceContent}>
              <a href={source.href} target="_blank" rel="noopener noreferrer"><span className={s.sourceMeta}>{source.publisher || "원문 보도"}{timestamp(source.publishedAt) && <> · {timestamp(source.publishedAt)}</>}</span><span className={s.sourceTitle}>{source.title}<span aria-hidden="true">↗</span></span></a>
              {source.broadcast && <a className={s.prominence} href={source.broadcast.url} target="_blank" rel="noopener noreferrer"><span>방송 선두 배치 확인 ↗</span><span>{source.broadcast.label}</span></a>}
            </div>
          </li>)}</ol>
        </section>}

        <footer className={s.colophon}><strong>하루조각 · 하루만평</strong><p>같은 날짜의 만평 한 장을 모두가 함께 봐요.<br />뉴스를 바탕으로 AI가 만든 비유이며 실제 장면의 재현은 아니에요.<br />사실관계와 자세한 맥락은 원문 보도를 함께 확인해 주세요.</p></footer>
      </main>
      <BottomNav />
    </>
  );
}

function CartoonStatus({ cartoon, loading, posting, enabled, beforeAvailable, isToday, canRequest, onRequest }) {
  const working = posting || pending(cartoon);
  const drawing = cartoon?.stage === "drawing";
  const exhausted = Number.isFinite(cartoon?.attempts) && cartoon.attempts >= (cartoon.maxAttempts ?? 3);
  const retryAt = !working && !exhausted && ["failed", "unavailable"].includes(cartoon?.status) && !canRequest ? timestamp(cartoon.retryAt) : null;
  let title = "이날은 발행된 만평이 없어요", detail = "다른 날짜의 지면도 펼쳐보세요.";
  if (loading) { title = "지면을 펼치고 있어요"; detail = "잠시만 기다려 주세요."; }
  else if (working) { title = drawing ? "만평 한 장을 그리고 있어요" : "대표 뉴스를 살펴보고 있어요"; detail = "완성되면 이 자리에 보여드릴게요."; }
  else if (cartoon?.status === "failed") { title = exhausted ? "이날의 생성 시도를 모두 사용했어요" : `${isToday ? "오늘" : "이날"}의 만평을 완성하지 못했어요`; detail = exhausted ? "이 날짜는 더 요청할 수 없어요. 다른 날짜의 만평을 펼쳐보세요." : canRequest ? "다시 시도할 수 있어요." : retryAt ? "잠시 뒤 다시 시도할 수 있어요." : cartoon.error || "잠시 후 다시 확인해 주세요."; }
  else if (cartoon?.status === "unavailable") { title = exhausted ? "이날의 생성 시도를 모두 사용했어요" : "선정할 뉴스를 확인하지 못했어요"; detail = exhausted ? "뉴스를 다시 찾아봤지만 충분한 근거를 확인하지 못했어요. 다른 날짜의 만평을 펼쳐보세요." : canRequest ? "방송 선두 기사와 다른 매체의 보도를 다시 확인할 수 있어요. 근거가 부족하면 다른 기사로 대신 채우지 않아요." : retryAt ? "잠시 뒤 뉴스를 다시 선정할 수 있어요." : cartoon.error || "확인할 수 있는 보도를 찾지 못했어요. 다시 불러와 재선정 가능 여부를 확인해 주세요."; }
  else if (!enabled) { title = "하루만평을 준비하고 있어요"; detail = "새로운 지면이 열리면 이곳에서 만나요."; }
  else if (isToday && beforeAvailable) { title = "밤 10시 이후에 만나요"; detail = "저녁 주요 보도가 모이면 선두 기사와 독립 매체의 보도를 확인해 오늘의 만평을 준비해요."; }
  else if (isToday) { title = "오늘의 지면을 준비해요"; detail = "대표 뉴스 한 가지를 골라 모두가 함께 볼 만평을 만들어요."; }
  else if (canRequest) { title = "이날의 만평을 만들어 보세요"; detail = "버튼을 누르면 선택한 날짜의 보도에서 대표 뉴스를 찾아 만평을 만들어요."; }
  return <div className={`${s.emptyPicture} ${working ? s.working : ""}`} role="status" aria-live="polite">
    <span className={s.emptyMark} aria-hidden="true">{working ? "◎" : "✳"}</span><strong>{title}</strong><p>{detail}</p>
    {retryAt && <p className={s.retryTime}><time dateTime={cartoon.retryAt}>{retryAt}</time> 이후 재시도 가능 (한국 시간)</p>}
    {Number.isFinite(cartoon?.attempts) && <small className={s.attempts}>{cartoon.attempts} / {cartoon.maxAttempts ?? 3}회 사용</small>}
    {working && <div className={s.progress}><span className={!drawing ? s.currentStep : ""}>뉴스 선정</span><i aria-hidden="true" /><span className={drawing ? s.currentStep : ""}>만평 그리기</span></div>}
    {!posting && !loading && !exhausted && canRequest && <button onClick={onRequest}>{cartoon?.status === "unavailable" ? "뉴스 다시 선정하기" : cartoon ? "다시 시도하기" : isToday ? "오늘의 만평 준비하기" : "이날의 만평 준비하기"}</button>}
  </div>;
}
