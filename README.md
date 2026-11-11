# 하루조각_front

하루조각(`haru-jogak/`)에서 **프론트 담당 범위만** 떼어낸 Next.js 프로젝트입니다.
기준: Google Sheets "하루조각 간트 차트"에서 프론트 담당자가 맡은 작업. `[프론트]` F1~F24 + 백엔드 중 B9(소셜 로그인), B22(개인정보처리방침 내용 검토).

- 추출일: 2026-11-10, 원본: 전체 앱 `haru-jogak` (저장소 `hjaehyun/webTest`, main `db9decf` 이후 로컬 상태). 이 문서의 `../haru-jogak/` 경로는 그 전체 앱을 가리킵니다.
- 백엔드에 전달할 내용: `docs/backend-handoff.md`, 방침·약관 검토 기록: `docs/2026-11-10-privacy-review.md`
- 백엔드 코드는 소셜 로그인(B9)만 들어 있습니다. 화면은 나머지 `/api/*`를 그대로 호출하므로 **백엔드 없이 실행하면 로그인 이후 화면은 동작하지 않습니다.**

## 들어 있는 것

| 경로 | 내용 |
|---|---|
| `src/app/**/page.tsx`, `*.module.css` | 화면 (아래 표) |
| `src/app/layout.tsx`, `globals.css` | 공통 틀, PC 폰 프레임 |
| `src/components/` | `ui.tsx`, `Picture.tsx`, `Art.tsx`, `SongCard.tsx` |
| `src/lib/` | `store.tsx`(상태 + API 호출), `ai.ts`, `types.ts`, `date.ts`, `geo.ts`, `download.ts`, `exhibitions.ts`, `inflight.ts`, `styles.ts`, `seed.ts`(미사용) |
| `public/scenes/` | 예시 그림 6장 |

### 소셜 로그인 (B9)

| 경로 | 내용 |
|---|---|
| `src/app/api/auth/oauth/[provider]/route.ts` | `GET /api/auth/oauth/kakao\|google` → 제공자 로그인 화면으로 302 |
| `src/app/api/auth/callback/route.ts` | `GET /api/auth/callback?code=` → 세션 쿠키, 같은 이메일 자동 연결 거부(`/?error=linked`) |
| `src/server/oauth.ts`, `oauth.test.ts` | 규칙(제공자 목록, `safeNext`, `accountInfo`, `isLinkConflict`)과 시험 |
| `src/server/supabase.ts`, `src/server/auth.ts` | 위 라우트가 쓰는 공용 도우미. **백엔드 소유(B5), 그대로 복사한 것**이라 여기서 고치지 않기 |
| `specs/haru-social-login.spl` | SPL 명세 (SPL Viewer code `haru-social-login`) |
| `docs/social-login-setup.md` | 카카오·구글·Supabase 설정 안내 |
| `.env.example` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (이 두 개만 필요) |

소셜 로그인 관련 화면 쪽(F7)은 `src/app/page.tsx`(버튼, `?error=oauth|linked` 문구), `src/app/me/page.tsx`(비밀번호 변경 숨김, "탈퇴" 입력)입니다.
원본에서 `accountInfo`를 쓰는 `GET/DELETE /api/me`(B7·B8)는 백엔드 담당이라 넣지 않았습니다.

### 개인정보처리방침 (B22)

따로 서버 코드는 없습니다. 검토 대상은 `src/app/privacy/page.tsx`(방침), `src/app/terms/page.tsx`(약관)이고 이미 들어 있습니다.
방침 내용은 실제 동작(저장 컬럼, 외부 AI·API 호출, 탈퇴 시 삭제)과 맞아야 하므로, 검토할 때는 원본의 `../haru-jogak/supabase/schema.sql`, `../haru-jogak/.env.example`(외부 서비스 목록)과 대조하세요.

## 뺀 것 (백엔드 담당)

| 원본 경로 | 내용 |
|---|---|
| `src/app/api/` | 소셜 로그인 2개를 뺀 서버 API 라우트 전부 |
| `src/server/` | DB 쿼리, AI, 노래, 날씨, 검증 등 (`oauth`, `supabase`, `auth`만 넣음) |
| `src/middleware.ts` | CSRF 검사 (간트 B4) |
| `supabase/`, `scripts/`, 나머지 `specs/` | 스키마, 시험 스크립트, SPL 명세 |
| 나머지 환경변수 | AI, 노래, 날씨 키와 `SUPABASE_SECRET_KEY`(탈퇴 전용) |

## 원본과 다른 점

1. `src/lib/mockSong.ts` 추가: 원본 `src/server/music/mock.ts`의 `isMockVideo` 한 줄을 옮김.
2. `src/components/SongCard.tsx`: import 경로를 `@/server/music/mock` → `@/lib/mockSong`으로 변경.
3. `package.json`: 이름만 `haru-jogak-front`로 변경 (의존성은 원본과 같음).
4. `.env.example`: Supabase 두 값만 남김.
5. `docs/social-login-setup.md`: 원본은 `../docs/setup/`에 있음.

원본으로 되돌려 합칠 때는 `src/app`, `src/components`, `src/lib`, `public`, `src/server/oauth*.ts`만 덮어쓰면 됩니다(`src/server/supabase.ts`·`auth.ts`는 원본 것을 유지). 2번 import는 그대로 둬도 동작합니다(`mockSong.ts`도 같이 복사).

## 간트 작업과 파일

| 작업 | 내용 | 파일 |
|---|---|---|
| F1 | 화면 설계 | (문서) |
| F2 | 프로젝트 세팅, 폰 프레임 | `package.json`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/globals.css` |
| F3 | 로그인·회원가입 | `src/app/page.tsx`, `src/app/login.module.css` |
| F4 | 프로필 (닉네임, 그림체 4종) | `src/app/profile/`, `src/lib/styles.ts` |
| F5 | 사용 가이드 | `src/app/guide/` |
| F6 | 마이페이지 | `src/app/me/` |
| F7 | 소셜 로그인 버튼·오류 문구·마이페이지 분기 | `src/app/page.tsx`, `src/app/me/page.tsx` |
| F8 | 개인정보처리방침·약관 | `src/app/privacy/`, `src/app/terms/`, `src/app/legal.module.css` |
| F9 | 조각글 피드 (쓰기·수정·삭제) | `src/app/today/`, `src/lib/store.tsx` |
| F10 | 이미지 첨부 UI·미리보기 | **아직 없음** |
| F11 | 위치 권한·좌표 반올림 | `src/lib/geo.ts` |
| F12 | 마감 버튼·그리는 중 표시 | `src/app/today/page.tsx`, `src/lib/ai.ts` |
| F13 | 그림 표시 컴포넌트 | `src/components/Picture.tsx`, `src/components/Art.tsx`, `public/scenes/` |
| F14 | 다시 그리기 버튼 | `src/app/gallery/[date]/page.tsx` |
| F15 | AI 한도 초과 문구 | `src/lib/ai.ts`, `src/lib/store.tsx` (서버가 준 오류 문구 표시) |
| F16 | 달력형 갤러리 | `src/app/gallery/` |
| F17 | 그림 상세, 내려받기 | `src/app/gallery/[date]/`, `src/lib/download.ts` |
| F18 | 노래 카드 | `src/components/SongCard.tsx` |
| F19 | 전시 그림 고르기 | `src/app/exhibition/pick/` |
| F20 | 공개 전시 화면 | `src/app/e/[id]/`, `src/lib/exhibitions.ts` |
| F21 | 전시회 여러 개 | `src/app/exhibition/` (**현재 1개 고정**) |
| F22 | 큐레이터 화면 | `src/app/curator/` |
| F23~F24 | 화면 흐름 시험, 배포 확인 | (백엔드와 합친 뒤) |
| B9 | 소셜 로그인 (카카오·구글 OAuth, 같은 이메일 거부) | `src/app/api/auth/oauth/`, `src/app/api/auth/callback/`, `src/server/oauth.ts` |
| B22 | 개인정보처리방침 내용 검토 | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` |

## 프론트가 부르는 API (백엔드와의 약속)

호출 위치는 `src/lib/store.tsx`, `src/lib/ai.ts`, `src/lib/exhibitions.ts`, `src/app/page.tsx` 네 곳뿐입니다. 요청·응답 타입은 `src/lib/types.ts`.

| 메서드 | 경로 | 쓰는 곳 |
|---|---|---|
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` | 로그인 화면, 마이페이지 |
| GET (링크) | `/api/auth/oauth/kakao`, `/api/auth/oauth/google` | 소셜 로그인 버튼 (**이 폴더에 있음**) |
| GET | `/api/auth/callback` | 제공자가 돌아오는 주소 (**이 폴더에 있음**) |
| GET | `/api/me` | 앱 시작 시 전체 데이터 |
| DELETE | `/api/me` | 탈퇴 |
| PUT | `/api/me/password`, `/api/me/profile` | 마이페이지, 프로필 |
| POST | `/api/me/entries` | 조각글 쓰기 |
| PATCH, DELETE | `/api/me/entries/[id]` | 조각글 수정·삭제 |
| POST | `/api/me/artworks` | 마감 후 그림 저장 |
| POST | `/api/me/artworks/[date]/redraw` | 다시 그리기 |
| POST | `/api/me/artworks/[date]/song` | 노래 추천·다른 곡 |
| POST | `/api/me/songs/[id]/feedback` | 노래 좋아요 |
| PATCH | `/api/me/exhibition` | 전시 그림·공개 여부 |
| GET | `/api/exhibitions/[id]` | 공개 전시 |
| POST | `/api/summarize`, `/api/draw`, `/api/curate` | 장면 정리, 그림, 큐레이터 |

## 실행

```bash
npm install
```

```bash
npm run dev
```

http://localhost:3000 에서 로그인 화면, `/privacy`, `/terms`는 보입니다. 그 밖의 화면은 `/api/me`가 없어 로그인 화면으로 돌아갑니다. 전체 동작은 `../haru-jogak/`에서 확인하세요.

소셜 로그인:

- `.env.local`에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`가 있어야 합니다(`.env.example` 참고). 없으면 버튼을 눌러도 `/?error=oauth`로 돌아옵니다.
- Supabase Redirect URLs에 등록된 주소는 `http://localhost:3000/api/auth/callback`입니다. **3000번 포트로 실행**해야 로그인이 끝까지 됩니다(`../haru-jogak` 개발 서버와 동시에 켜지 않기).
- 로그인에 성공해도 이 폴더에는 `/api/me`가 없어 다음 화면에서 로그인 화면으로 돌아옵니다. 세션 쿠키(`sb-*`)가 생겼는지로 확인하세요.

시험: `npm test` (`geo`, `inflight`, `oauth` 순수 함수, Node 24 이상).
