// Public terms of service (linked from the login screen and the Google OAuth consent screen).

import Link from "next/link";
import { TopBar } from "@/components/ui";
import s from "../legal.module.css";

export const metadata = { title: "서비스 약관 · 하루조각" };

export default function TermsPage() {
  return (
    <div className="app">
      <TopBar title="서비스 약관" back="/" />
      <main className={`scroll ${s.main}`}>
        <p className={s.meta}>시행일 2026년 11월 10일</p>

        <h2>1. 서비스</h2>
        <p>
          하루조각은 하루 동안 남긴 짧은 글을 모아 AI가 그림일기 한 장으로 그려주는 서비스예요. 웹프로그래밍 수업 팀
          프로젝트로 운영하며 무료예요.
        </p>

        <h2>2. 계정</h2>
        <ul>
          <li>이메일 또는 카카오·Google 계정으로 가입할 수 있어요</li>
          <li>계정은 본인만 쓰고, 비밀번호는 다른 사람과 나누지 말아 주세요</li>
          <li>이미 이메일로 가입한 주소는 같은 주소의 소셜 계정으로 로그인할 수 없어요(계정 보호)</li>
          <li>마이페이지에서 언제든 탈퇴할 수 있고, 탈퇴하면 모든 기록이 지워지며 되돌릴 수 없어요</li>
        </ul>

        <h2>3. 내가 쓴 글과 그림</h2>
        <ul>
          <li>조각글과 만들어진 그림의 권리는 쓴 사람에게 있어요</li>
          <li>
            서비스는 그림을 만들고 보여주기 위해서만 그것들을 써요. 이를 위해 외부 AI로 보내는 내용과 그 쓰임은{" "}
            <Link href="/privacy">개인정보처리방침</Link>을 따라요
          </li>
          <li>
            AI가 그린 그림과 해설은 조각글과 다르거나 어색할 수 있어요. 마음에 들지 않으면 다시 그리기를 써 주세요
          </li>
        </ul>

        <h2>4. 하지 말아야 할 일</h2>
        <ul>
          <li>남을 해치거나 법을 어기는 내용, 다른 사람의 개인 정보를 올리기</li>
          <li>자동화 도구로 AI 기능을 대량 호출하거나 서비스를 방해하기</li>
          <li>공개 전시에 다른 사람의 권리를 침해하는 내용을 걸기</li>
        </ul>
        <p>이런 일이 있으면 해당 기록이나 계정 이용을 제한할 수 있어요.</p>

        <h2>5. 이용 한도와 변경</h2>
        <ul>
          <li>AI 기능은 하루 사용 횟수에 한도가 있고, 외부 AI 사정에 따라 임시 요약·예시 그림으로 대신할 수 있어요</li>
          <li>수업 프로젝트라 기능이 바뀌거나 학기 이후 서비스가 끝날 수 있어요. 끝나기 전에 미리 알릴게요</li>
        </ul>

        <h2>6. 책임</h2>
        <p>
          무료 수업 프로젝트로 제공돼 서비스 중단이나 기록 손실에 대해 책임을 지기 어려워요. 소중한 그림은 그림 상세에서
          내려받아 두세요.
        </p>

        <h2>7. 개인정보</h2>
        <p>
          개인정보는 <Link href="/privacy">개인정보처리방침</Link>에 따라 다뤄요.
        </p>
      </main>
    </div>
  );
}
