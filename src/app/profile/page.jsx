"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Art from "@/components/Art";
import { IconBack } from "@/components/ui";
import { useStore } from "@/lib/store";
import { STYLES, withParticle } from "@/lib/styles";
import s from "./profile.module.css";

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
  const { db, ready, authed, error, setProfile, signOut } = useStore();
  const [step, setStep] = useState("name");

  useEffect(() => {
    if (ready && !authed && !error) router.replace("/");
  }, [ready, authed, error, router]);
  const [nick, setNick] = useState("");
  const [picked, setPicked] = useState(null);

  // Prefill when editing an existing profile. /profile?step=style (the my page's
  // style "바꾸기") opens straight on the style step.
  const [prefilled, setPrefilled] = useState(false);
  const [editing, setEditing] = useState(false);
  if (ready && !prefilled) {
    setPrefilled(true);
    if (db.profile) {
      setEditing(true);
      setNick(db.profile.nick);
      setPicked(db.profile.style);
      if (params.get("step") === "style") setStep("style");
    }
  }

  const name = nick.trim();

  function next() {
    if (!name) return;
    // Editing already has a style, so the name step saves on its own.
    if (editing) return start();
    setNick(name);
    setStep("style");
  }

  function start() {
    if (!picked) return;
    setProfile({ nick: name, style: picked });
    // First setup goes on to the how-to slides; an edit returns to the my page.
    router.push(editing ? "/me" : "/guide");
  }

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
                await signOut();
                router.replace("/");
              }}
            >
              로그아웃
            </button>
          </span>
        </header>
      )}

      <main className={`scroll ${s.main}`}>
        {step === "name" ? (
          <div className={s.section}>
            <div className={s.title}>
              {editing ? (
                <>
                  <h1 className="hand">어떤 이름으로 바꿀까요?</h1>
                  <p>바꾼 이름은 갤러리와 전시회에 바로 보여요.</p>
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
                autoFocus
              />
              <span className={s.count}>{nick.length}/12</span>
            </label>
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
      </main>

      <div className="bar">
        {step === "name" ? (
          <button className="btn" onClick={next} disabled={!name}>
            {editing ? "이름 저장하기" : "다음"}
          </button>
        ) : (
          <button className="btn" onClick={start} disabled={!picked}>
            {picked ? withParticle(picked) + (editing ? " 저장하기" : " 시작하기") : "그림체를 골라주세요"}
          </button>
        )}
      </div>
    </div>
  );
}
