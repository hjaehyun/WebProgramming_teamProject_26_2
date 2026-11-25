"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BottomNav, IconNext, ProfileButton, Screen, TopBar } from "@/components/ui";
import { longDate } from "@/lib/date";
import { validJournalDate } from "@/lib/journal-calendar";
import { useJournalToday } from "@/lib/use-journal-today";
import { useConnection } from "@/lib/connection-client";
import { useStore } from "@/lib/store";
import s from "./connection.module.css";

const working = item => item && ["queued", "processing"].includes(item.status);
const dateLabel = day => `${Number(day.slice(0, 4))}년 ${longDate(day)}`;
function timestamp(value, withTime = true) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date) : null;
}
function dateRange(from, to) {
  const start = timestamp(from, false), end = timestamp(to, false);
  return start && end ? `${start} – ${end}` : null;
}
function sourceUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export default function ConnectionPage() {
  return <Screen><Suspense fallback={<div className="loading">하루의 연결을 불러오고 있어요…</div>}><ConnectionRoute /></Suspense></Screen>;
}

function ConnectionRoute() {
  const params = useSearchParams();
  const today = useJournalToday();
  const date = params.has("date") ? params.get("date") : today;
  if (!validJournalDate(date) || date > today) return <>
    <TopBar title="날짜 확인" back="/gallery" />
    <div className={s.invalid}><h2>오늘까지의 기록을 골라 주세요</h2><p>달력에서 연결할 일기 날짜를 확인해 주세요.</p><Link className="btn ghost" href="/gallery">달력으로 돌아가기</Link></div>
  </>;
  return <Connection key={date} date={date} today={today} />;
}

function Connection({ date, today }) {
  const router = useRouter();
  const { db, flushEntries, refresh: refreshPersonal } = useStore();
  const { payload, error, loading, posting, refresh, start } = useConnection(date, flushEntries);
  const [mode, setMode] = useState("both");
  const personal = db.artworks[date];
  const entries = personal?.entries ?? db.drafts[date] ?? [];
  const result = payload?.connection;
  const busy = posting || working(result);
  const hasEntries = payload?.hasEntries ?? entries.length > 0;
  const consent = payload?.consent ?? !!db.profile?.consent;
  const dates = [...new Set([
    today, date, ...Object.keys(db.artworks),
    ...Object.keys(db.drafts).filter(day => db.drafts[day]?.length), ...(payload?.dates ?? []),
  ])].filter(day => validJournalDate(day) && day <= today).sort().reverse();
  const sources = (result?.sources ?? []).map(source => ({ ...source, href: sourceUrl(source.url) })).filter(source => source.href);
  const regenerate = result?.status === "ready" || result?.status === "no_match";
  const allowed = !!(payload?.enabled && consent && hasEntries && (regenerate ? payload.canRefresh : payload?.canRequest));
  const diaryHref = `/gallery/${date}`;
  const selectedAt = timestamp(result?.selectedAt);
  const range = dateRange(result?.newsFrom, result?.newsTo);
  const requestedRange = dateRange(payload?.newsFrom, payload?.newsTo);
  const requestLabel = regenerate ? "뉴스 다시 연결하기" : result ? "다시 연결하기" : "이날의 뉴스 연결하기";

  return <>
    <main className={`scroll ${s.paper}`}>
      <header className={s.header}>
        <div className={s.overline}><span>HARU CONNECTION</span><span>나만의 작은 연결</span></div>
        <div className={s.titleRow}><h1>하루연결<span aria-hidden="true">↗</span></h1><ProfileButton /></div>
        <p className={s.intro}>나의 작은 하루에서,<br />그 무렵 세상의 이야기로.</p>
        <nav className={s.sections} aria-label="뉴스 그림 메뉴">
          <Link href={`/cartoon?date=${date}`}>하루만평 <span>함께 보는 뉴스</span></Link>
          <Link href={`/connection?date=${date}`} aria-current="page">하루연결 <span>내 기록과 닿은 뉴스</span></Link>
        </nav>
      </header>

      <section className={s.dateCard} aria-label="연결할 일기 선택">
        <label htmlFor="connection-date">어느 날의 일기를 연결할까요?</label>
        <select id="connection-date" value={date} onChange={event => router.replace(`/connection?date=${event.target.value}`, { scroll: false })}>
          {dates.map(day => <option key={day} value={day}>{dateLabel(day)}{day === today ? " · 오늘" : ""}</option>)}
        </select>
        <p><strong>일기 날짜 기준 이전 한 달(당일 포함)</strong>의 보도에서 찾아요.</p>
        {requestedRange && <p>새로 연결할 뉴스 범위 · {requestedRange} (한국 시간)</p>}
      </section>

      {error && <div className={s.notice} role="alert"><p>{error}</p><button type="button" onClick={refresh} disabled={posting}>다시 불러오기</button></div>}

      {result?.sourceChanged && <div className={s.changed} role="status"><strong>연결한 뒤 기록이 바뀌었어요</strong><p>아래 뉴스는 이전 조각글·장면을 바탕으로 찾았어요. 현재 기록을 반영하려면 다시 연결해 주세요.</p></div>}
      {result?.rangeChanged && <div className={s.changed} role="status"><strong>저장된 뉴스의 검색 범위가 달라요</strong><p>아래 결과는 이전 검색 범위로 저장됐어요. 일기 날짜 기준 이전 한 달(당일 포함)로 찾으려면 다시 연결해 주세요.</p></div>}

      <section className={s.requestCard} aria-label="뉴스 연결 요청">
        <div className={s.requestHeading}><span className={s.smallLabel}>일기에서 주제로, 주제에서 뉴스로</span><span className={s.private}>나만 보기</span></div>
        {!loading && !hasEntries ? <>
          <h2>한 조각이면 시작할 수 있어요</h2><p>이날 기억나는 순간을 먼저 남겨 주세요. 개인 그림이 없어도 글만으로 뉴스를 연결할 수 있어요.</p>
          <Link href={diaryHref} className={s.primary}>이날 기록하기 <IconNext /></Link>
        </> : <>
          <h2>{busy ? "하루와 뉴스 사이를 잇고 있어요" : regenerate ? "이날의 기록과 이어진 뉴스" : "어떤 이야기가 이어질까요?"}</h2>
          <p className={s.privacy}>버튼을 누르면 이날의 <strong>일기 원문과 그림에 저장된 장면 요약·태그를 OpenAI로 보내</strong> 관련 주제를 찾아요.</p>
          <details className={s.details}><summary>어떤 정보가 전송되나요?</summary><p>뉴스 웹검색에는 미리 정한 일반 주제만 사용해요. 일기 원문·그림 파일·계정 정보는 웹검색에 보내지 않아요. 그림 파일 자체를 AI로 분석하지 않으며, 기존 내 그림은 그대로 유지돼요. 연결 결과는 나만 볼 수 있고 공개 전시에 포함되지 않아요. <Link href="/privacy">개인정보처리방침</Link></p></details>
          {busy ? <Progress stage={result?.stage} /> : <>
            <button type="button" className={s.primary} disabled={loading || !allowed} onClick={() => start(regenerate)}>{loading ? "연결 정보를 확인하는 중…" : requestLabel}<span aria-hidden="true">↗</span></button>
            {!consent && !loading && <p className={s.blocked}>AI 전송 동의 후 새 연결을 만들 수 있어요. <Link href="/profile">동의 설정하기</Link></p>}
            {consent && payload?.blockedReason && <p className={s.blocked}>{payload.blockedReason}</p>}
            {!loading && payload && !payload.enabled && <p className={s.blocked}>하루연결 서비스를 준비하고 있어요.</p>}
            {payload?.retryAt && <p className={s.blocked}><time dateTime={payload.retryAt}>{timestamp(payload.retryAt)}</time> 이후 재시도할 수 있어요. (한국 시간)</p>}
          </>}
          <p className={s.limit}>{result ? `이날 ${result.attempts ?? 0} / ${result.maxAttempts ?? 3}회 사용 · ` : ""}일기 날짜마다 실패를 포함해 최대 3회 연결해요.</p>
          {regenerate && <p className={s.cacheNote}>저장된 결과예요. 다시 연결하면 일기 날짜 기준의 범위에서 새로 찾아요.</p>}
        </>}
      </section>

      {(result || entries.length > 0 || personal) && <>
        <div className={s.sectionHeading}><h2>두 장면의 연결</h2><span>내 기록 × 연결된 뉴스</span></div>
        <div className={s.viewModes} role="group" aria-label="그림 보기 방식">
          {[["both", "나란히"], ["personal", "내 하루 크게"], ["news", "뉴스 그림 크게"]].map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
        </div>
        <div className={`${s.pictures} ${mode === "both" ? s.comparing : ""}`}>
          {mode !== "news" && <figure className={s.panel}>
            <div className={s.panelHeading}><span className={s.panelNumber}>01</span><h3>나의 하루</h3></div>
            {personal?.status === "ready" ? <ConnectionImage key={personal.imageUrl} url={personal.imageUrl} imageError={personal.imageError} alt={personal.summary || "이날의 내 그림"} onReload={refreshPersonal} /> : <div className={s.diaryPreview}>
              <span className={s.diaryMark} aria-hidden="true">“</span>
              <strong>{working(personal) ? "내 그림을 그리고 있어요" : personal?.status === "failed" ? "내 그림을 완성하지 못했어요" : "그림 대신, 이날의 조각"}</strong>
              {entries.slice(0, 2).map(entry => <p key={entry.id}>{entry.text}</p>)}
              {!entries.length && <p>아직 저장된 조각글이 없어요.</p>}
              <small>그림 없이도 글로 연결할 수 있어요.</small>
            </div>}
            <figcaption>{dateLabel(date)}<span>내가 남긴 일기</span></figcaption>
            <Link className={s.inlineLink} href={diaryHref}>{personal ? "내 기록 보기" : "이날 기록·그림 만들기"}<IconNext /></Link>
          </figure>}
          {mode !== "personal" && <figure className={s.panel}>
            <div className={s.panelHeading}><span className={s.panelNumber}>02</span><h3>연결된 뉴스</h3><span className={s.aiTag}>AI 그림</span></div>
            {result?.status === "ready" ? <ConnectionImage key={result.imageUrl} url={result.imageUrl} imageError={result.imageError} alt={result.caption || result.headline || "일기 주제와 연결된 뉴스의 AI 그림"} onReload={refresh} /> : <ConnectionStatus result={result} loading={loading} posting={posting} />}
            <figcaption>{result?.headline || "일기 주제와 닿아 있는 이야기"}<span>{range ? `보도 범위 · ${range}` : "일기 주제에 연결된 뉴스"}</span></figcaption>
          </figure>}
        </div>
      </>}

      {result?.topics?.length > 0 && <div className={s.topics} aria-label="일기에서 찾은 주제"><span>연결한 주제</span>{result.topics.map(topic => <span className={s.topic} key={topic.code}>{topic.label}</span>)}</div>}

      {result?.headline && <section className={s.article} aria-label="연결된 뉴스 읽기">
        <div className={s.articleKicker}><span>CONNECTED STORY</span><span>보도와 일기의 접점</span></div>
        <h2>{result.headline}</h2>
        {result.connectionReason && <div className={s.reason}><h3>내 하루와 이어지는 지점</h3><p>{result.connectionReason}</p></div>}
        <div className={s.articleBlock}><h3>뉴스 요약 <small>보도된 사실</small></h3><p>{result.summary || "뉴스를 정리하고 있어요."}</p></div>
        {result.caption && <div className={s.articleBlock}><h3>그림 이야기 <small>AI가 표현한 장면</small></h3><p>{result.caption}</p></div>}
      </section>}

      {(range || selectedAt) && <div className={s.searchMeta}>
        {selectedAt && <p>뉴스 검색 · <time dateTime={result.selectedAt}>{selectedAt}</time> (한국 시간)</p>}
        {range && <p>보도 검색 범위 · {range}</p>}
        <span>표시된 결과를 찾을 때 사용한 보도 범위예요.</span>
      </div>}

      {sources.length > 0 && <section className={s.sources} aria-labelledby="connection-sources">
        <h2 id="connection-sources">원문으로 이어 읽기<span>{sources.length}개 출처</span></h2>
        <ol>{sources.map((source, index) => <li key={`${source.href}-${index}`}><a href={source.href} target="_blank" rel="noopener noreferrer">
          <span className={s.sourceMeta}>{source.publisher || "원문 보도"}{timestamp(source.publishedAt) && ` · ${timestamp(source.publishedAt)}`}</span>
          <span className={s.sourceTitle}>{source.title}<span aria-hidden="true">↗</span></span>
        </a></li>)}</ol>
      </section>}

      <footer className={s.footer}><strong>하루조각 · 하루연결</strong><p>관련성은 AI가 제안한 하나의 관점이에요.<br />뉴스 그림은 AI가 만든 표현이며 실제 보도 사진이 아니에요.<br />정확한 사실과 맥락은 원문 보도를 함께 확인해 주세요.</p><Link href={`/gallery?month=${date.slice(0, 7)}`}>이날의 달력으로 돌아가기</Link></footer>
    </main>
    <BottomNav />
  </>;
}

function Progress({ stage }) {
  const steps = [["topics", "주제 찾기"], ["searching", "뉴스 찾기"], ["drawing", "그림 그리기"]];
  const index = Math.max(0, steps.findIndex(([value]) => value === stage));
  return <div className={s.progress} role="status" aria-live="polite"><strong>{steps[index][1]} 중…</strong><ol>{steps.map(([value, label], i) => <li key={value} className={i === index ? s.activeStep : i < index ? s.doneStep : ""}><span aria-hidden="true">{i < index ? "✓" : i + 1}</span>{label}</li>)}</ol><p>화면을 닫았다 돌아와도 요청한 연결을 이어서 확인할 수 있어요.</p></div>;
}

function ConnectionStatus({ result, loading, posting }) {
  let title = "이곳에 뉴스 그림이 놓여요", detail = "위에서 연결을 시작해 주세요.";
  if (loading) { title = "연결을 불러오고 있어요"; detail = "잠시만 기다려 주세요."; }
  else if (posting || working(result)) { title = result?.stage === "drawing" ? "뉴스 그림을 그리고 있어요" : "이어지는 이야기를 찾고 있어요"; detail = "내 하루에서 출발한 뉴스를 준비해요."; }
  else if (result?.status === "no_match") { title = "잘 맞는 뉴스를 찾지 못했어요"; detail = "검색 범위 안에서 충분히 관련 있는 기사를 확인하지 못했어요."; }
  else if (result?.status === "failed") { title = "연결을 완성하지 못했어요"; detail = result.error || "잠시 후 다시 시도해 주세요."; }
  else if (result?.status === "cancelled") { title = "이 연결은 중단됐어요"; detail = result.error || "기록과 AI 전송 동의를 확인해 주세요."; }
  return <div className={s.emptyPicture} role="status"><span aria-hidden="true">↗</span><strong>{title}</strong><p>{detail}</p></div>;
}

function ConnectionImage({ url, imageError, alt, onReload }) {
  const [failed, setFailed] = useState(false);
  if (!url || imageError || failed) return <div className={s.emptyPicture}><strong>그림을 불러오지 못했어요</strong><p>저장된 그림의 연결을 다시 확인해 주세요.</p><button type="button" onClick={() => { setFailed(false); void onReload(); }}>다시 불러오기</button></div>;
  // Never substitute an example illustration for a user's saved image.
  // eslint-disable-next-line @next/next/no-img-element
  return <div className={s.imageBox}><img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} /></div>;
}
