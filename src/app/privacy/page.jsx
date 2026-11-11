// Public privacy policy (linked from the login screen and the Google OAuth consent screen).
// Keep it in sync with what the app actually does: stored columns, AI/API calls, deletion.

import { TopBar } from "@/components/ui";
import s from "../legal.module.css";

export const metadata = { title: "개인정보처리방침 · 하루조각" };

const CONTACT = "https://github.com/hjaehyun/webTest/issues";

export default function PrivacyPage() {
  return (
    <div className="app">
      <TopBar title="개인정보처리방침" back="/" />
      <main className={`scroll ${s.main}`}>
        <p className={s.meta}>시행일 2026년 11월 11일</p>
        <p>
          하루조각은 웹프로그래밍 수업 팀 프로젝트로 만든 그림일기 서비스예요. 서비스에 필요한 정보만 받고, 탈퇴하면 모두
          지워요.
        </p>

        <h2>1. 받는 정보</h2>
        <table className={s.table}>
          <tbody>
            <tr>
              <th>계정</th>
              <td>
                이메일, 비밀번호(암호화되어 저장), 가입 시각. 카카오·Google로 시작하면 그 서비스가 알려준 이메일과 계정
                식별 정보(닉네임·프로필 사진이 함께 올 수 있어요)
              </td>
            </tr>
            <tr>
              <th>프로필</th>
              <td>직접 정한 닉네임, 고른 그림체</td>
            </tr>
            <tr>
              <th>일기</th>
              <td>
                조각글과 쓴 시각, 그 시각의 날씨·기온, 그림, 장면 요약·태그·그날 분위기, 추천 노래와 노래 검색어, 노래
                좋아요, 전시 제목·소개글·그림별 설명
              </td>
            </tr>
            <tr>
              <th>이용 기록</th>
              <td>AI 기능을 하루에 쓴 횟수(한도 확인용)</td>
            </tr>
            <tr>
              <th>위치</th>
              <td>
                허용한 경우에만 조각글을 올릴 때 대략적인 위치(소수점 둘째 자리)를 날씨 조회에 한 번 쓰고{" "}
                <strong>저장하지 않아요</strong>
              </td>
            </tr>
          </tbody>
        </table>

        <h2>2. 쓰는 곳</h2>
        <ul>
          <li>로그인과 내 기록 보여주기</li>
          <li>하루를 마감하면 조각글을 모아 장면을 정리하고 그림 한 장으로 그리기</li>
          <li>그날 분위기에 맞는 노래 추천, 기간별 큐레이터 해설</li>
          <li>공개로 설정한 전시회를 링크로 보여주기</li>
        </ul>

        <h2>3. 다른 회사로 보내는 정보</h2>
        <table className={s.table}>
          <tbody>
            <tr>
              <th>Supabase</th>
              <td>계정과 일기 저장(데이터베이스, 그림 파일, 로그인). 접속 기록(IP 주소 등)이 남을 수 있어요</td>
            </tr>
            <tr>
              <th>Google Gemini</th>
              <td>
                그날 조각글(시각·날씨 포함) → 장면 정리, 그림 요약 → 큐레이터 해설. 무료 등급이라 Google이 서비스 개선에
                쓸 수 있어요. 그래서 이름이나 연락처는 적지 말아 주세요
              </td>
            </tr>
            <tr>
              <th>Cloudflare Workers AI</th>
              <td>그림 설명(영어 문장) → 그림 생성</td>
            </tr>
            <tr>
              <th>YouTube</th>
              <td>
                AI가 쓴 노래 검색어(분위기 단어). 숫자·주소는 걸러내고, 이름·장소는 넣지 않도록 AI에 지시해요. 노래
                카드에서 &lsquo;YouTube로 듣기&rsquo;를 누르면 그때 YouTube 플레이어(쿠키를 줄인 주소)가 열려요. 누르기
                전에는 YouTube에 접속하지 않아요
              </td>
            </tr>
            <tr>
              <th>기상청</th>
              <td>위치에서 바꾼 격자 번호 → 날씨 조회</td>
            </tr>
            <tr>
              <th>Vercel</th>
              <td>서비스 운영(서버). 접속 기록(IP 주소 등)이 남을 수 있어요</td>
            </tr>
            <tr>
              <th>카카오, Google</th>
              <td>소셜 로그인을 고른 경우에만 로그인 확인</td>
            </tr>
          </tbody>
        </table>
        <p>위 회사들의 서버는 해외에 있을 수 있어요.</p>

        <h2>4. 공개되는 정보</h2>
        <p>
          전시회를 공개로 바꾸면 링크를 아는 사람 누구나 전시 제목·소개글, 닉네임, 고른 그림과 그 날짜, 장면 요약·설명,
          추천 노래를 볼 수 있어요. 조각글과 이메일은 공개되지 않아요. 언제든 비공개로 돌릴 수 있어요.
        </p>

        <h2>5. 보관 기간과 삭제</h2>
        <ul>
          <li>탈퇴할 때까지 보관하고, 탈퇴하면 계정·조각글·그림·그림 파일·전시를 바로 모두 지워요</li>
          <li>이미 Google Gemini 같은 외부 AI로 보낸 내용은 되돌리거나 지울 수 없어요</li>
          <li>
            조각글은 하루를 마감하기 전까지 고치거나 지울 수 있고, 그림은 다시 그릴 수 있어요. 마감한 날의 조각글과
            그림은 따로 지울 수 없고, 탈퇴하면 함께 지워져요
          </li>
          <li>노래 목록(곡 제목·채널)은 개인 정보 없이 공유 보관하고, 30일이 지나면 추천에 쓰지 않고 지워요</li>
        </ul>

        <h2>6. 내 정보 보기·고치기·지우기</h2>
        <ul>
          <li>내 기록은 오늘·갤러리·전시회 화면에서 볼 수 있어요</li>
          <li>닉네임·그림체·비밀번호는 마이페이지에서 고칠 수 있어요</li>
          <li>모두 지우려면 마이페이지에서 탈퇴하면 돼요. 그 밖의 요청은 아래 문의로 알려 주세요</li>
        </ul>

        <h2>7. 쿠키</h2>
        <p>로그인 유지를 위한 쿠키만 써요. 광고·분석 쿠키는 쓰지 않아요.</p>

        <h2>8. 문의</h2>
        <p>
          개인정보 관련 문의는{" "}
          <a href={CONTACT} target="_blank" rel="noreferrer">
            GitHub 저장소 이슈
          </a>
          로 남겨 주세요. 이슈는 누구나 볼 수 있는 공개 게시판이니 개인 정보는 적지 말아 주세요. 수업 프로젝트라 정식
          사업자가 아니며, 내용이 바뀌면 이 페이지에 먼저 알려요.
        </p>
      </main>
    </div>
  );
}
