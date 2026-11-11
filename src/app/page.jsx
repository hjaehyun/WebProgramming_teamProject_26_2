"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { finishAuthentication } from "@/lib/auth-flow";
import s from "./login.module.css";

const LOGO = ["#C9D3F2", "#F3D9A8", "#D6E6D2", "#F0CFC6", null, "#DCD3EE"];

// Authentication callbacks return fixed messages, never the provider's own text.
const AUTH_ERRORS = {
  oauth: "로그인하지 못했어요. 잠시 후 다시 해주세요",
  linked: "이미 이메일로 가입한 주소예요. 이메일로 로그인해 주세요",
  confirmation: "인증 링크가 만료되었거나 사용할 수 없어요. 이미 인증했다면 로그인해 주세요.",
};

export default function LoginPage() {
  return <Suspense fallback={<div className="app" />}><LoginForm /></Suspense>;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, authed, db, signIn, signUp } = useStore();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const linkMessage = params.get("password") === "updated" ? "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요." : params.get("error") ? AUTH_ERRORS[params.get("error")] ?? AUTH_ERRORS.oauth : null;
  const shownMessage = message || (!dismissed && linkMessage);
  const signup = mode === "signup";

  // Already signed in (e.g. coming back later): skip the form.
  useEffect(() => {
    if (ready && authed) router.replace(db.profile ? "/today" : "/profile");
  }, [ready, authed, db.profile, router]);

  async function onSubmit(e) {
    e.preventDefault();
    setDismissed(true);
    if (busy) return;
    if (signup && password.length < 8) {
      setMessage("비밀번호는 8자 이상이어야 해요");
      return;
    }
    setBusy(true);
    setMessage(null);
    setConfirmationSent(false);
    try {
      await finishAuthentication(
        signup ? signUp(email, password) : signIn(email, password),
        () => { setConfirmationSent(true); setPassword(""); setBusy(false); },
        path => router.push(path),
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "잠시 후 다시 해주세요");
      setBusy(false);
    }
  }

  function switchMode() {
    if (busy) return;
    setMode(signup ? "login" : "signup");
    setMessage(null);
    setConfirmationSent(false);
    setDismissed(true);
  }

  return (
    <div className="app">
      <div className={s.wrap}>
        <div className={s.hero}>
          <div className={s.logo} aria-hidden="true">
            {LOGO.map((c, i) => (
              <div key={i} className={c ? s.tile : `${s.tile} ${s.empty}`} style={c ? { background: c } : undefined} />
            ))}
          </div>
          <div className={s.copy}>
            <h1 className="hand">하루조각</h1>
            <p>
              무심코 남긴 조각들이 모여,
              <br />
              그날이 그려집니다
            </p>
          </div>
        </div>

        <form className={s.form} onSubmit={onSubmit}>
          <label className="field">
            이메일
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); setConfirmationSent(false); }}
            />
          </label>
          <label className="field">
            비밀번호
            <input
              className="input"
              type="password"
              placeholder="8자 이상"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={signup ? 8 : undefined}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setConfirmationSent(false); }}
            />
          </label>
          {!signup && <Link href="/forgot-password">비밀번호를 잊으셨나요?</Link>}
          {confirmationSent && (
            <p className={s.success} role="status">
              인증 메일을 확인해 주세요. 가입 가능한 주소라면 메일을 보냈어요. 이미 가입했다면 로그인해 주세요.
            </p>
          )}
          {shownMessage && (
            <p className={s.error} role="alert">
              {shownMessage}
            </p>
          )}
          {signup && (
            <p className={s.notice}>
              프로필에서 AI 전송에 동의하면 조각글과 작성 시각을 OpenAI로 보내 장면을 정리하고 그림을 만들어요.
              자세한 내용은 개인정보처리방침에서 확인해 주세요.
            </p>
          )}
          <button className="btn" type="submit" style={{ marginTop: 8 }} disabled={busy}>
            {busy ? "잠시만요…" : signup ? "가입하기" : "로그인"}
          </button>
          <div className={s.or} aria-hidden="true">
            또는
          </div>
          {/* Full-page navigation: the server route sets the PKCE cookie and redirects to the provider. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route, needs a real navigation */}
          <a className={`${s.social} ${s.kakao}`} href="/api/auth/oauth/kakao">
            <KakaoSymbol />
            카카오로 시작하기
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route, needs a real navigation */}
          <a className={`${s.social} ${s.google}`} href="/api/auth/oauth/google">
            <GoogleG />
            Google로 시작하기
          </a>
          <div className={s.signup}>
            {signup ? "이미 계정이 있나요?" : "처음이신가요?"}
            <button type="button" onClick={switchMode} disabled={busy}>
              {signup ? "로그인" : "회원가입"}
            </button>
          </div>
          <p className={s.legal}>
            시작하면 <Link href="/terms">서비스 약관</Link>과 <Link href="/privacy">개인정보처리방침</Link>에 동의하는 것으로
            봐요
          </p>
        </form>
      </div>
    </div>
  );
}

/** Kakao speech-bubble symbol (black on #FEE500, per Kakao login button guide). */
function KakaoSymbol() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#000"
        d="M9 1.5C4.58 1.5 1 4.32 1 7.8c0 2.25 1.5 4.22 3.75 5.33l-.96 3.5c-.08.3.26.54.52.37l4.16-2.75c.17.01.35.02.53.02 4.42 0 8-2.82 8-6.3S13.42 1.5 9 1.5z"
      />
    </svg>
  );
}

/** Google "G" logo in its standard colors (per Google sign-in branding guidelines). */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
