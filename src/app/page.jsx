"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
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
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const passwordInput = useRef(null);
  const confirmationInput = useRef(null);
  const confirmationNotice = useRef(null);
  const formHeading = useRef(null);
  const modeFocusTarget = useRef(null);
  const authenticationPending = useRef(false);
  const resendPending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState(null);
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [resendMessage, setResendMessage] = useState(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const linkMessage = params.get("password") === "updated" ? "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요." : params.get("error") ? AUTH_ERRORS[params.get("error")] ?? AUTH_ERRORS.oauth : null;
  const shownMessage = message || (!dismissed && linkMessage);
  const signup = mode === "signup";

  // Already signed in (e.g. coming back later): skip the form.
  useEffect(() => {
    if (ready && authed) router.replace(db.profile ? "/today" : "/profile");
  }, [ready, authed, db.profile, router]);

  useEffect(() => {
    if (confirmationSent) confirmationNotice.current?.focus();
  }, [confirmationSent]);

  useEffect(() => {
    if (modeFocusTarget.current === "password") passwordInput.current?.focus();
    else if (modeFocusTarget.current === "heading") formHeading.current?.focus();
    modeFocusTarget.current = null;
  }, [mode]);

  useEffect(() => {
    if (!resendAvailableAt) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
      setResendSeconds(seconds);
      if (!seconds) clearInterval(timer);
    };
    const timer = setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [resendAvailableAt]);

  function startResendCooldown(seconds = 60) {
    const delay = Number.isFinite(seconds) ? Math.max(60, Math.ceil(seconds)) : 60;
    setResendAvailableAt(Date.now() + delay * 1000);
    setResendSeconds(delay);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setDismissed(true);
    if (busy || resending || authenticationPending.current) return;
    if (signup && password.length < 8) {
      setMessage("비밀번호는 8자 이상이어야 해요");
      passwordInput.current?.focus();
      return;
    }
    if (signup && password !== passwordConfirmation) {
      setPasswordMismatch(true);
      setMessage("비밀번호가 서로 달라요. 다시 확인해 주세요.");
      confirmationInput.current?.focus();
      return;
    }
    authenticationPending.current = true;
    setBusy(true);
    setMessage(null);
    setPasswordMismatch(false);
    setResendMessage(null);
    setConfirmationSent(false);
    try {
      const result = await (signup ? signUp(email, password) : signIn(email, password));
      if (signup) { setPassword(""); setPasswordConfirmation(""); }
      await finishAuthentication(
        result,
        () => { setConfirmationSent(true); startResendCooldown(); setBusy(false); },
        path => router.push(path),
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "잠시 후 다시 해주세요");
      setBusy(false);
    } finally {
      authenticationPending.current = false;
    }
  }

  function switchMode(focusPassword = false) {
    if (busy || resending || authenticationPending.current || resendPending.current) return;
    modeFocusTarget.current = focusPassword ? "password" : "heading";
    setMode(signup ? "login" : "signup");
    setPassword("");
    setPasswordConfirmation("");
    setMessage(null);
    setPasswordMismatch(false);
    setConfirmationSent(false);
    setResendMessage(null);
    setResendAvailableAt(0);
    setResendSeconds(0);
    setDismissed(true);
  }

  async function resendConfirmation() {
    if (!signup || !confirmationSent || busy || resendPending.current || Date.now() < resendAvailableAt) return;
    resendPending.current = true;
    setResending(true);
    setResendMessage(null);
    startResendCooldown();
    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => null);
      const retryAfter = Number(response.headers.get("Retry-After"));
      startResendCooldown(Math.max(Number(data?.retryAfterSeconds) || 60, retryAfter || 0));
      if (!response.ok) throw new Error(data?.error || "인증 메일을 다시 요청하지 못했어요. 잠시 후 다시 해주세요.");
      setResendMessage({ ok: true, text: data?.message || "인증 메일을 다시 요청했어요. 인증이 필요한 계정이라면 메일함을 확인해 주세요." });
    } catch (err) {
      setResendMessage({ ok: false, text: err instanceof Error ? err.message : "잠시 후 다시 해주세요." });
    } finally {
      resendPending.current = false;
      setResending(false);
    }
  }

  return (
    <div className="app">
      <div className={signup ? `${s.wrap} ${s.signupMode}` : s.wrap}>
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

        <form className={s.form} onSubmit={onSubmit} aria-labelledby="auth-form-title">
          <div className={s.formHeading}>
            <h2 id="auth-form-title" ref={formHeading} tabIndex={-1}>{signup ? "회원가입" : "로그인"}</h2>
            <p>{signup ? "이메일을 인증하고 나만의 하루조각을 시작해요." : "남겨 둔 조각들을 이어서 만나보세요."}</p>
          </div>
          <label className="field">
            이메일
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={busy || resending}
              aria-describedby={signup ? "signup-email-hint" : undefined}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setConfirmationSent(false); setResendMessage(null); }}
            />
            {signup && <span className={s.fieldHint} id="signup-email-hint">인증 메일을 받을 수 있는 주소를 입력해 주세요.</span>}
          </label>
          <label className="field">
            비밀번호
            <input
              ref={passwordInput}
              className="input"
              type="password"
              placeholder="8자 이상"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              disabled={busy || resending}
              minLength={signup ? 8 : undefined}
              maxLength={128}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setConfirmationSent(false); setPasswordMismatch(false); setMessage(null); }}
            />
          </label>
          {signup && <label className="field">
            비밀번호 확인
            <input ref={confirmationInput} className="input" type="password" autoComplete="new-password" placeholder="비밀번호를 한 번 더 입력해 주세요" required minLength={8} maxLength={128} disabled={busy || resending} value={passwordConfirmation}
              aria-invalid={passwordMismatch || undefined} aria-describedby={passwordMismatch ? "auth-error" : undefined}
              onChange={(e) => { setPasswordConfirmation(e.target.value); setPasswordMismatch(false); setMessage(null); }} />
          </label>}
          {!signup && <Link href="/forgot-password">비밀번호를 잊으셨나요?</Link>}
          {signup && confirmationSent && (
            <div className={s.confirmation} ref={confirmationNotice} tabIndex={-1} aria-label="가입 요청 안내">
              <div className={s.confirmationMessage} role="status">
                <strong>가입 요청을 확인했어요.</strong>
                <p>새로 가입하는 주소라면 인증 메일을 확인해 주세요.</p>
                <p>이미 인증을 완료한 계정에는 가입 인증 메일이 다시 발송되지 않아요. 로그인하거나 비밀번호를 재설정해 주세요.</p>
              </div>
              <div className={s.mailHelp}>
                <strong>메일이 보이지 않나요?</strong>
                <ul>
                  <li>스팸메일함과 프로모션함을 확인해 주세요.</li>
                  <li>이메일 주소에 오타가 없는지, 수신 차단 설정이 되어 있는지 확인해 주세요.</li>
                  <li>몇 분 기다린 뒤에도 없다면 인증 메일을 다시 요청해 주세요.</li>
                </ul>
              </div>
              <button className={`btn ghost ${s.resend}`} type="button" disabled={busy || resending || resendSeconds > 0} onClick={resendConfirmation}>
                {resending ? "인증 메일 요청 중…" : resendSeconds > 0 ? `인증 메일 다시 받기 (${resendSeconds}초)` : "인증 메일 다시 받기"}
              </button>
              {resendMessage && <p className={resendMessage.ok ? s.resendStatus : s.error} role={resendMessage.ok ? "status" : "alert"}>{resendMessage.text}</p>}
              <div className={s.confirmationActions} role="group" aria-label="기존 계정으로 계속하기">
                <button className="btn" type="button" disabled={busy || resending} onClick={() => switchMode(true)}>
                  로그인하기
                </button>
                <Link className="btn ghost" href="/forgot-password">비밀번호 재설정</Link>
              </div>
            </div>
          )}
          {shownMessage && (
            <p className={s.error} role="alert" id="auth-error">
              {shownMessage}
            </p>
          )}
          {signup && (
            <p className={s.notice}>
              프로필에서 AI 전송에 동의하면 조각글과 작성 시각을 OpenAI로 보내 장면을 정리하고 그림을 만들어요.
              자세한 내용은 개인정보처리방침에서 확인해 주세요.
            </p>
          )}
          <button className="btn" type="submit" style={{ marginTop: 8 }} disabled={busy || resending}>
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
            <button type="button" onClick={() => switchMode()} disabled={busy || resending}>
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
