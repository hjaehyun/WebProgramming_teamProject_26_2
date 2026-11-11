"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconNext() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function TopBar({ title, back, children }) {
  return (
    <header className="topbar">
      <Link href={back} aria-label="뒤로" className="icon-btn">
        <IconBack />
      </Link>
      <h1>{title}</h1>
      {children}
    </header>
  );
}

/** Top-right avatar on the main tabs; opens the my page. */
export function ProfileButton() {
  const { db } = useStore();
  const nick = db.profile?.nick ?? "";
  return (
    <Link href="/me" className="avatar-btn" aria-label="마이페이지" title="마이페이지">
      <span className="hand" aria-hidden="true">
        {nick.charAt(0) || "나"}
      </span>
    </Link>
  );
}

const TABS = [
  {
    href: "/today",
    label: "오늘",
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
      </>
    ),
  },
  {
    href: "/gallery",
    label: "갤러리",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </>
    ),
  },
  {
    href: "/exhibition",
    label: "전시회",
    icon: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="1" />
        <rect x="8" y="7" width="8" height="8" />
      </>
    ),
  },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="주 메뉴">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path.startsWith(t.href) ? "page" : undefined}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.icon}
          </svg>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Wraps signed-in screens: waits for the store, sends users without a profile to setup. */
export function Screen({ children, dark }) {
  const { ready, authed, error, db } = useStore();
  const router = useRouter();
  const needsLogin = ready && !authed && !error;
  const needsProfile = ready && authed && !db.profile;

  useEffect(() => {
    if (needsLogin) router.replace("/");
    else if (needsProfile) router.replace("/profile");
  }, [needsLogin, needsProfile, router]);

  return (
    <div className={dark ? "app dark" : "app"}>
      {error ? (
        <div className="loading">{error}</div>
      ) : ready && authed && !needsProfile ? (
        children
      ) : (
        <div className="loading">불러오는 중…</div>
      )}
    </div>
  );
}
