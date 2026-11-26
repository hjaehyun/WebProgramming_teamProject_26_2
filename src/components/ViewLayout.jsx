"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { MainNavLinks } from "@/components/ui";

/** Opt-in layout only: the same page stays mounted, including its unsaved inputs. */
export default function ViewLayout({ children }) {
  const [desktop, setDesktop] = useState(false);
  const { authed, db } = useStore();
  const path = usePathname();
  const signedIn = authed && Boolean(db.profile);

  return (
    <div className="view-layout" data-layout={desktop ? "desktop" : "mobile"}>
      <div className="view-controls">
        <p className="view-caption">나의 하루를 담는 작은 미술관</p>
        <button className="view-toggle" type="button" onClick={() => setDesktop(value => !value)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {desktop ? <rect x="6" y="2" width="12" height="20" rx="3" /> : <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>}
          </svg>
          {desktop ? "모바일 화면으로 보기" : "PC 화면으로 보기"}
        </button>
      </div>

      <aside className="desktop-sidebar" aria-label="하루조각 탐색">
        <Link className="desktop-brand" href={signedIn ? "/today" : "/"}>
          <span className="desktop-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="hand">하루조각</span>
        </Link>
        <p className="desktop-tagline">평범한 하루도<br />한 장의 작품이 되도록.</p>
        {signedIn ? (
          <nav className="desktop-nav" aria-label="주 메뉴"><MainNavLinks /></nav>
        ) : (
          <nav className="desktop-nav" aria-label="서비스 메뉴">
            <Link href="/" aria-current={path === "/" ? "page" : undefined}>로그인 · 회원가입</Link>
            <Link href="/terms" aria-current={path === "/terms" ? "page" : undefined}>서비스 안내</Link>
          </nav>
        )}
        <div className="desktop-sidebar-bottom">
          {signedIn && <Link className="desktop-account" href="/me" aria-current={path === "/me" || path === "/profile" ? "page" : undefined}>
            <span className="hand" aria-hidden="true">{db.profile.nick?.charAt(0) || "나"}</span>
            <div><strong>{db.profile.nick || "나"}</strong><small>마이페이지</small></div>
          </Link>}
          <div className="desktop-help"><Link href={signedIn ? "/guide" : "/terms"}>이용 안내</Link><Link href="/privacy">개인정보처리방침</Link></div>
          <p>조각을 모아, 하루를 그리다.</p>
        </div>
      </aside>

      <div className="view-content">{children}</div>
    </div>
  );
}
