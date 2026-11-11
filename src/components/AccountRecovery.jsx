"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { TopBar } from "./ui";
export default function AccountRecovery({ reset = false }) {
  const router = useRouter();
  const { refresh } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    if (reset && password !== confirm) { setMessage("새 비밀번호가 서로 달라요."); return; }
    setBusy(true); setMessage("");
    try {
      const r = await fetch(`/api/auth/${reset ? "reset-password" : "forgot-password"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reset ? { password } : { email: email.trim() }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "요청을 완료하지 못했어요.");
      if (reset) { await refresh(); router.replace("/?password=updated"); router.refresh(); }
      else setMessage(data.message);
    } catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  }
  return <div className="app">
    <TopBar title={reset ? "새 비밀번호 설정" : "비밀번호 찾기"} back="/" />
    <main className="scroll" style={{ padding: 24 }}>
      <form onSubmit={submit} style={{ display: "grid", gap: 20 }}>
        {reset ? <>
          <label className="field">새 비밀번호<input className="input" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label className="field">새 비밀번호 확인<input className="input" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        </> : <label className="field">가입한 이메일<input className="input" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {message && <p role="status">{message}</p>}
        <button className="btn" disabled={busy}>{busy ? "처리 중…" : reset ? "비밀번호 저장" : "재설정 메일 받기"}</button>
      </form>
      {reset && <p><Link href="/forgot-password">재설정 메일 다시 받기</Link></p>}
    </main>
  </div>;
}
