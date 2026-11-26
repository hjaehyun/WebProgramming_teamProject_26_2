"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Art from "@/components/Art";
import { IconBack } from "@/components/ui";
import { useStore } from "@/lib/store";
import { STYLES, withParticle } from "@/lib/styles";
import s from "./profile.module.css";

const emptyArtProfile = () => ({ gender: "unspecified", ageRange: "unspecified", occupation: "", appearance: "" });
const genderOptions = [["unspecified", "선택 안 함"], ["female", "여성적인 모습"], ["male", "남성적인 모습"], ["neutral", "중성적인 모습"]];
const ageOptions = [["unspecified", "선택 안 함"], ["child", "어린이"], ["teen", "10대"], ["20s", "20대"], ["30s", "30대"], ["40s", "40대"], ["50s", "50대"], ["60plus", "60대 이상"]];
// The profile API stores single-line descriptions; the textarea wraps them visually.
const singleLineDetails = value => value.replace(/[\u0000-\u001f\u007f]+/g, " ");

// useSearchParams needs a Suspense boundary so the page can still be prerendered.
export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="app" />}>
      <Profile />
    </Suspense>
  );
}

function Profile() {
  const router = useRouter();
  const params = useSearchParams();
  const { db, ready, authed, error, refresh, setProfile, signOut, isCurrentSession } = useStore();
  const [step, setStep] = useState("name");

  useEffect(() => {
    if (ready && !authed && !error) router.replace("/");
  }, [ready, authed, error, router]);
  const [nick, setNick] = useState("");
  const [picked, setPicked] = useState(null);
  const [consent, setConsent] = useState(false);
  const [artProfile, setArtProfile] = useState(emptyArtProfile);
  const [artProfileEnabled, setArtProfileEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Keep edits during same-session refreshes, but never carry one account's
  // private appearance or consent choices into another login's form.
  const [prefilled, setPrefilled] = useState(null);
  const [editing, setEditing] = useState(false);
  const accountId = db.account?.id ?? null;
  if (ready && authed && !error && (!prefilled || prefilled.accountId !== accountId || !prefilled.isCurrentSession())) {
    const profile = db.profile;
    setPrefilled({ accountId, isCurrentSession });
    setEditing(Boolean(profile));
    setNick(profile?.nick ?? "");
    setPicked(profile?.style ?? null);
    setConsent(Boolean(profile?.consent));
    setArtProfile({ ...emptyArtProfile(), ...profile?.artProfile });
    setArtProfileEnabled(Boolean(profile?.consent && profile?.artProfileEnabled));
    setStep(profile && ["style", "details"].includes(params.get("step")) ? params.get("step") : "name");
    setSaving(false);
    setSaveError(null);
  }

  const name = nick.trim();

  function next() {
    if (!name) return;
    // Editing already has a style; save the name and optional illustration details together.
    if (editing) return start();
    setNick(name);
    setStep("style");
  }

  async function start() {
    if (!picked || saving || !isCurrentSession()) return;
    setSaving(true); setSaveError(null);
    try {
      await setProfile({ nick: name, style: picked, consent,
        artProfile: { ...artProfile, occupation: artProfile.occupation.trim(), appearance: artProfile.appearance.trim() },
        artProfileEnabled: consent && artProfileEnabled });
      // First setup goes on to the how-to slides; an edit returns to the my page.
      if (isCurrentSession()) router.push(editing ? "/me" : "/guide");
    } catch (e) { if (isCurrentSession()) setSaveError(e.message); }
    finally { if (isCurrentSession()) setSaving(false); }
  }

  if (error) return (
    <div className="app">
      <div className="loading">
        <p role="alert">{error}</p>
        <button className="btn ghost" onClick={() => refresh()}>다시 불러오기</button>
      </div>
    </div>
  );
  if (!ready || !authed) return <div className="app"><div className="loading">불러오는 중…</div></div>;

  return (
    <div className="app">
      {editing ? (
        // Editing from the my page: no setup steps, just a way back.
        <header className={s.head}>
          <Link href="/me" className={s.back}>
            <IconBack />
            마이페이지
          </Link>
        </header>
      ) : (
        <header className={s.head}>
          <div className={s.dots} aria-hidden="true">
            <span className={`${s.dot} ${s.on}`} />
            <span className={step === "style" ? `${s.dot} ${s.on}` : s.dot} />
          </div>
          <span className={s.headRight}>
            {step === "style" ? "2 / 2 단계" : "1 / 2 단계"}
            <button
              className={s.logout}
              onClick={async () => {
                try { await signOut(); router.replace("/"); }
                catch (e) { setSaveError(e.message); }
              }}
            >
              로그아웃
            </button>
          </span>
        </header>
      )}

      <main className={`scroll ${s.main}`}>
        {step !== "style" ? (
          <div className={`${s.section} ${s.detailsSection}`}>
            <div className={s.identity}>
            <div className={s.title}>
              {editing ? (
                <>
                  <h1 className="hand">{step === "details" ? "그림 속 내 모습" : "내 프로필을 다듬어요"}</h1>
                  <p>이름은 갤러리와 전시회에 보여요. 그림에 담을 내 모습은 원하는 만큼만 알려주세요.</p>
                </>
              ) : (
                <>
                  <h1 className="hand">
                    반가워요!
                    <br />
                    뭐라고 불러드릴까요?
                  </h1>
                  <p>갤러리와 전시회에 이 이름이 보여요.</p>
                </>
              )}
            </div>
            <label className={s.nameField}>
              <span>이름</span>
              <input
                className={`hand ${s.nameInput}`}
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) next();
                }}
                maxLength={12}
                placeholder="예: 재현"
                autoComplete="nickname"
                autoFocus={step !== "details"}
              />
              <span className={s.count}>{nick.length}/12</span>
            </label>
            </div>
            <section className={s.artProfile} aria-labelledby="art-profile-title" id="art-profile">
              <div className={s.detailsTitle}>
                <h2 id="art-profile-title">그림에 담을 내 모습 <span>선택 입력</span></h2>
                <p>인물이 등장하는 장면에서 참고해요. 비워 둔 정보는 추정하지 않고, 하는 일만으로 일기에 없는 사건을 만들지 않아요.</p>
              </div>
              <div className={s.detailGrid}>
                <label className={s.detailField} htmlFor="art-gender"><span>성별 표현</span>
                  <select id="art-gender" value={artProfile.gender} onChange={event => setArtProfile(previous => ({ ...previous, gender: event.target.value }))} disabled={saving}>
                    {genderOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className={s.detailField} htmlFor="art-age"><span>연령대</span>
                  <select id="art-age" value={artProfile.ageRange} onChange={event => setArtProfile(previous => ({ ...previous, ageRange: event.target.value }))} disabled={saving}>
                    {ageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
              <label className={s.detailField} htmlFor="art-occupation">
                <span className={s.fieldHeading}><span>하는 일</span><span id="art-occupation-count" className={s.fieldCount}>{artProfile.occupation.length}/80자</span></span>
                <input id="art-occupation" value={artProfile.occupation} onChange={event => setArtProfile(previous => ({ ...previous, occupation: singleLineDetails(event.target.value) }))} maxLength={80} placeholder="예: 대학생, 개발자, 정원사" autoComplete="off" disabled={saving} aria-describedby="art-occupation-count" />
              </label>
              <label className={s.detailField} htmlFor="art-appearance">
                <span className={s.fieldHeading}><span>외형 특징</span><span id="art-appearance-count" className={s.fieldCount}>{artProfile.appearance.length}/200자</span></span>
                <textarea id="art-appearance" value={artProfile.appearance} onChange={event => setArtProfile(previous => ({ ...previous, appearance: singleLineDetails(event.target.value) }))} rows={3} maxLength={200} placeholder="예: 짧은 머리, 둥근 안경" autoComplete="off" disabled={saving} aria-describedby="art-appearance-hint art-appearance-count" />
                <span id="art-appearance-hint" className={s.fieldHint}>특징은 쉼표로 나눠 적어주세요. 줄바꿈은 띄어쓰기로 바뀌어요.</span>
              </label>
              <div className={s.applyBox}>
                <label className={s.applyToggle} htmlFor="art-profile-enabled"><input id="art-profile-enabled" type="checkbox" checked={artProfileEnabled} disabled={!consent || saving} onChange={event => setArtProfileEnabled(event.target.checked)} aria-describedby="art-profile-status art-profile-explanation" /><span>내 그림에 반영하기</span></label>
                <p id="art-profile-status" className={s.applyStatus} role="status"><strong>{consent && artProfileEnabled ? "반영 켜짐" : "반영 꺼짐"}</strong>{consent && artProfileEnabled ? "저장하면 새로 만들거나 다시 그리는 그림부터 적용해요." : "현재 성별·외형 정보는 그림에 반영되지 않아요."}</p>
                <p id="art-profile-explanation">켜면 입력한 정보를 OpenAI로 보내 내 그림을 그릴 때 참고해요. 이미 완성된 그림은 자동으로 바뀌지 않아요.</p>
                {(!consent || !artProfileEnabled) && <p className={s.consentHint}>{consent ? "성별 선택만으로는 반영되지 않아요. 위의 ‘내 그림에 반영하기’를 켜고 저장해 주세요." : "반영하려면 아래 ‘AI 전송에 동의해요’를 선택한 뒤, 위의 ‘내 그림에 반영하기’도 켜고 저장해 주세요."}</p>}
              </div>
              <p className={s.detailsNote}>입력한 프로필 항목은 공개 전시에 표시되지 않아요. 전시를 공개하면 이 모습이 반영된 그림은 다른 사람도 볼 수 있어요.</p>
            </section>
          </div>
        ) : (
          <div className={s.section}>
            <div className={`${s.nameCard} rise`}>
              <span className={`hand ${s.avatar}`}>{name.charAt(0)}</span>
              <span className={s.nameText}>
                <span>이름</span>
                <strong>{name}</strong>
              </span>
              <button className={s.edit} onClick={() => setStep("name")}>
                바꾸기
              </button>
            </div>

            <div className={`${s.title} rise`}>
              {editing ? (
                <>
                  <h1 className="hand">어떤 그림체로 바꿀까요?</h1>
                  <p>앞으로 그릴 그림부터 적용돼요. 이미 그린 그림은 그대로예요.</p>
                </>
              ) : (
                <>
                  <h1 className="hand">
                    {name}님의 하루,
                    <br />
                    어떤 그림으로 남길까요?
                  </h1>
                  <p>눌러서 골라주세요. 나중에 바꿀 수 있어요.</p>
                </>
              )}
            </div>

            <div role="radiogroup" aria-label="그림체" className={s.grid}>
              {STYLES.map((st, i) => {
                const on = st.id === picked;
                return (
                  <button
                    key={st.id}
                    role="radio"
                    aria-checked={on}
                    className={`${s.pick} ${on ? s.pickOn : ""} rise`}
                    style={{ animationDelay: `${(i + 1) * 60}ms` }}
                    onClick={() => setPicked(st.id)}
                  >
                    <span className={s.thumb}>
                      <Art scene={st.sample} />
                    </span>
                    <span className={s.check} aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    </span>
                    <span className={s.pickText}>
                      <strong>{st.label}</strong>
                      <span>{st.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <section className={s.consentBox} aria-label="AI 전송 동의">
          <label className={s.applyToggle} htmlFor="ai-consent">
            <input id="ai-consent" type="checkbox" checked={consent} disabled={saving} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) setArtProfileEnabled(false); }} aria-describedby="ai-consent-description ai-consent-optional" />
            <span>AI 전송에 동의해요 <span className={s.optional}>(선택)</span></span>
          </label>
          <p id="ai-consent-description">조각글·작성 시각·저장된 장면 요약과 태그를 OpenAI로 보내 그림·큐레이터 해설·하루연결의 주제를 만들어요. ‘내 그림에 반영하기’를 켠 프로필 정보는 내 그림 생성에도 사용돼요.</p>
          <p id="ai-consent-optional">동의하지 않아도 글은 저장할 수 있어요. <Link href="/privacy">전송 정보 확인</Link></p>
        </section>
      </main>

      <div className={`bar ${s.actions}`}>
        {saveError && <p className={s.saveError} role="alert">{saveError}</p>}
        {step !== "style" ? (
          <button className="btn" onClick={next} disabled={!name || saving}>
            {saving ? "저장하는 중…" : editing ? "프로필 저장하기" : "다음"}
          </button>
        ) : (
          <button className="btn" onClick={start} disabled={!picked || saving}>
            {picked ? withParticle(picked) + (editing ? " 저장하기" : " 시작하기") : "그림체를 골라주세요"}
          </button>
        )}
      </div>
    </div>
  );
}
