"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Art from "@/components/Art";
import { IconNext, Screen, TopBar } from "@/components/ui";
import { addDays, todayKey } from "@/lib/date";
import { useStore } from "@/lib/store";
import { styleOf } from "@/lib/styles";
import s from "./me.module.css";

export default function MyPage() {
  return (
    <Screen>
      <Me />
    </Screen>
  );
}

/** Days in a row with a picture, ending today (or yesterday, so an unclosed today doesn't break it). */
function streak(dates) {
  let day = todayKey();
  if (!dates.has(day)) day = addDays(day, -1);
  let n = 0;
  while (dates.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

function joinedLabel(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} 가입`;
}

const PROVIDER_NAME = { kakao: "카카오", google: "Google" };

/** "you@x.com" for email accounts; "카카오 로그인 · you@x.com" (or just the provider) for social ones. */
function accountLabel(a) {
  if (a.kind === "email" || a.provider === "email") return a.email;
  const name = `${PROVIDER_NAME[a.provider]} 로그인`;
  return a.email ? `${name} · ${a.email}` : name;
}

function Me() {
  const router = useRouter();
  const { db, signOut } = useStore();
  const profile = db.profile;
  const style = styleOf(profile.style);
  const [open, setOpen] = useState(null);
  const social = db.account?.kind === "social";

  const artworks = Object.values(db.artworks);
  const pieceCount =
    artworks.reduce((sum, a) => sum + a.entries.length, 0) +
    Object.values(db.drafts).reduce((sum, list) => sum + list.length, 0);
  const days = streak(new Set(artworks.map((a) => a.date)));
  const ex = db.exhibition;

  async function logout() {
    try { await signOut(); router.replace("/"); }
    catch (e) { alert(e.message || "로그아웃하지 못했어요. 다시 시도해 주세요."); }
  }

  return (
    <>
      <TopBar title="마이페이지" back="/today" />

      <main className={`scroll ${s.main}`}>
        {db.deletionPending && <p role="alert">탈퇴 정리가 아직 끝나지 않았어요. 아래 회원탈퇴에서 다시 시도하면 남은 파일 삭제를 이어서 처리해요.</p>}
        <section className={s.hero}>
          <span className={`hand ${s.avatar}`} aria-hidden="true">
            {profile.nick.charAt(0)}
          </span>
          <div className={s.who}>
            <strong className="hand">{profile.nick}</strong>
            {db.account && (
              <>
                <span>{accountLabel(db.account)}</span>
                <span className={s.faint}>{joinedLabel(db.account.joinedAt)}</span>
              </>
            )}
          </div>
          <Link href="/profile" className={s.edit}>
            프로필 편집
          </Link>
        </section>

        <section className={s.stats} aria-label="내 기록">
          <div>
            <strong>{pieceCount}</strong>
            <span>모은 조각</span>
          </div>
          <div>
            <strong>{artworks.length}</strong>
            <span>그린 그림</span>
          </div>
          <div>
            <strong>
              {days}
              <small>일</small>
            </strong>
            <span>연속 기록</span>
          </div>
        </section>

        <section className={`card ${s.styleCard}`}>
          <span className={s.thumb}>
            <Art scene={style.sample} />
          </span>
          <div className={s.styleText}>
            <span className="eyebrow">내 그림체</span>
            <strong>{style.label}</strong>
            <span>{style.desc}</span>
          </div>
          <Link href="/profile?step=style" className={s.small}>
            바꾸기
          </Link>
        </section>

        <nav className={s.list} aria-label="바로가기">
          <Link href="/exhibition" className={s.row}>
            <span>내 전시회</span>
            <span className={s.meta}>
              {ex.isPublic ? "공개 중" : "나만 보기"} · 그림 {ex.dates.length}장
            </span>
            <IconNext />
          </Link>
          <Link href="/curator" className={s.row}>
            <span>AI 큐레이터</span>
            <span className={s.meta}>기간별 그림 해설</span>
            <IconNext />
          </Link>
          <Link href="/guide" className={s.row}>
            <span>사용 가이드</span>
            <span className={s.meta}>다시 보기</span>
            <IconNext />
          </Link>
        </nav>

        <section className={s.list} aria-label="계정">
          {!social && (
            <button
              className={s.row}
              aria-expanded={open === "password"}
              onClick={() => setOpen(open === "password" ? null : "password")}
            >
              <span>비밀번호 변경</span>
              <span className={s.meta} />
              <IconNext />
            </button>
          )}
          {!social && open === "password" && <PasswordForm onDone={() => setOpen(null)} />}
          <button className={s.row} onClick={logout}>
            <span>로그아웃</span>
          </button>
        </section>

        <div className={s.danger}>
          <button
            className={s.dangerLink}
            aria-expanded={open === "delete"}
            onClick={() => setOpen(open === "delete" ? null : "delete")}
          >
            회원탈퇴
          </button>
          {open === "delete" && <DeleteForm social={social} onCancel={() => setOpen(null)} />}
        </div>
      </main>
    </>
  );
}

function PasswordForm({ onDone }) {
  const { changePassword } = useStore();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (next.length < 8) {
      setMessage({ ok: false, text: "새 비밀번호는 8자 이상이어야 해요" });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setMessage({ ok: true, text: "바꿨어요. 다른 기기에서는 다시 로그인해야 해요." });
      setCurrent("");
      setNext("");
      setTimeout(onDone, 1500);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "바꾸지 못했어요" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <label className="field">
        지금 비밀번호
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="field">
        새 비밀번호
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="8자 이상"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      {message && (
        <p className={message.ok ? s.ok : s.error} role="status">
          {message.text}
        </p>
      )}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </button>
    </form>
  );
}

function DeleteForm({ social, onCancel }) {
  const router = useRouter();
  const { deleteAccount } = useStore();
  const [password, setPassword] = useState(""); // social accounts type '탈퇴' here instead
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await deleteAccount(social ? { confirm: password.trim() } : { password });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "탈퇴하지 못했어요");
      setBusy(false);
    }
  }

  return (
    <form className={`${s.form} ${s.dangerForm}`} onSubmit={submit}>
      <p>
        탈퇴하면 지금까지 쓴 조각, 그림, 전시가 <strong>모두 지워지고 되돌릴 수 없어요.</strong>
      </p>
      <label className="field">
        {social ? "확인을 위해 '탈퇴'를 입력해 주세요" : "비밀번호 확인"}
        <input
          className="input"
          type={social ? "text" : "password"}
          autoComplete={social ? "off" : "current-password"}
          placeholder={social ? "탈퇴" : undefined}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.dangerActions}>
        <button type="button" className="btn ghost" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className={`btn ${s.dangerBtn}`} disabled={busy || (social ? password.trim() !== "탈퇴" : !password)}>
          {busy ? "지우는 중…" : "탈퇴하기"}
        </button>
      </div>
    </form>
  );
}
