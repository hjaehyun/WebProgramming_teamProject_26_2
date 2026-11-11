// Public privacy policy (linked from the login screen and the Google OAuth consent screen).
// Keep it in sync with what the app actually does: stored columns, AI/API calls, deletion.

import { TopBar } from "@/components/ui";
import s from "../legal.module.css";

export const metadata = { title: "개인정보처리방침 · 하루조각" };

const CONTACT = "https://github.com/hjaehyun/WebProgramming_teamProject_26_2/issues";

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
                이메일, 비밀번호 확인용 해시, 가입 시각. 카카오·Google로 시작하면 그 서비스가 알려준 이메일과 계정
                식별 정보(닉네임·프로필 사진이 함께 올 수 있어요)
              </td>
            </tr>
            <tr>
              <th>프로필</th>
              <td>직접 정한 닉네임, 고른 그림체, AI 전송 동의 시각</td>
            </tr>
            <tr>
              <th>일기</th>
              <td>
                조각글과 쓴 시각, 그림, 장면 요약·태그, 그림 생성 상태와 시도 횟수, 전시 제목·소개글·그림별 설명
              </td>
            </tr>
            <tr>
              <th>이용 기록</th>
              <td>큐레이터를 하루에 쓴 횟수와 그림별 생성 시도 횟수(한도 확인용)</td>
            </tr>
            <tr>
              <th>위치</th>
              <td>
                현재 날씨 조회는 연결 준비 중이며 위치를 요청하거나 저장하지 않아요. 연결 시 전송 정보와 이용 방법을 먼저 안내해요.
              </td>
            </tr>
          </tbody>
        </table>

        <h2>2. 쓰는 곳</h2>
        <ul>
          <li>로그인과 내 기록 보여주기</li>
          <li>하루를 마감하면 조각글을 모아 장면을 정리하고 그림 한 장으로 그리기</li>
          <li>기간별 큐레이터 해설</li>
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
              <th>OpenAI</th>
              <td>
                동의한 경우 조각글·작성 시각을 장면 정리에, 장면 설명을 그림 생성에, 저장된 장면 요약·태그·날짜를 큐레이터 해설에 보내요. 계정 이메일·닉네임을 별도 항목으로 보내지 않지만, 글에 직접 적은 개인 정보는 포함될 수 있어요.
              </td>
            </tr>
            <tr>
              <th>인증 메일</th>
              <td>Supabase에 설정한 메일 발송 서비스를 통해 이메일 인증·비밀번호 재설정 메일을 보내요. 현재 Resend를 사용해요.</td>
            </tr>
            <tr>
              <th>YouTube</th>
              <td>
                노래 추천은 현재 연결 준비 중이며 검색 요청을 보내지 않아요. 연결 시 전송 정보를 먼저 안내해요.
              </td>
            </tr>
            <tr>
              <th>기상청</th>
              <td>날씨 조회는 현재 연결 준비 중이며 정보를 보내지 않아요.</td>
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
          전시회를 공개로 바꾸면 링크를 아는 사람 누구나 전시 제목·소개글, 닉네임, 고른 그림과 그 날짜, 장면 요약·설명을
          볼 수 있어요. 조각글과 이메일은 공개되지 않아요. 언제든 비공개로 돌릴 수 있어요.
        </p>

        <h2>5. 보관 기간과 삭제</h2>
        <ul>
          <li>탈퇴할 때까지 보관해요. 진행 중인 그림 작업이 끝난 뒤 탈퇴할 수 있고, 그림 파일을 먼저 삭제한 다음 계정과 기록을 삭제해요. 삭제가 중단되면 탈퇴를 다시 시도해 남은 정리를 마칠 수 있어요.</li>
          <li>외부 AI로 보낸 정보는 해당 서비스의 보관 정책도 적용돼요.</li>
          <li>
            조각글은 하루를 마감하기 전까지 고치거나 지울 수 있고, 그림은 다시 그릴 수 있어요. 마감한 날의 조각글과
            그림은 따로 지울 수 없고, 탈퇴하면 함께 지워져요
          </li>
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
