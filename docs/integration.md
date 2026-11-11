# 하루조각 통합 안내

이 문서는 `codex/backend-integration`의 현재 구현을 설명합니다. 프론트 기준 커밋은 `6155d3a`이며, 조원의 UI와 JavaScript/JSX 화면을 유지하면서 기존 하루조각의 TypeScript 백엔드를 맞춰 연결했습니다. Next.js 버전은 `16.4.5`입니다.

**추가 마이그레이션을 적용하고, 새 UI·작업 처리기를 [기존 운영 주소](https://harujogak-hihellow18.vercel.app)에 배포했습니다.** 이후 Gmail SMTP의 새 주소 가입·인증·비밀번호 로그인, 운영 크레파스 재생성·갤러리를 확인했습니다. 새 계정의 합성 조각글 저장과 자연 Cron의 동화책 생성·만료 선점 복구도 실제 이미지까지 확인했습니다. 자동 작업 시험은 날짜·선점 시각을 조정한 자료를 사용했습니다. [배포 기록](deployment-2026-11-11.md), [운영 흐름 검증](production-flow-verification-2026-11-11.md), [SMTP 검증 기록](gmail-smtp-verification-2026-11-11.md), [자동 작업 검증](automatic-worker-verification-2026-11-11.md)을 구분합니다.

## 담당 범위와 구조

프론트 담당 조원의 화면을 기준으로, 사용자 담당인 DB·인증·GPT 그림 생성·자동 처리를 통합했습니다. 날씨·음악 등 추가 외부 API는 나머지 조원의 담당 범위로 남깁니다. 임의의 추천 곡이나 날씨를 실제 API 결과처럼 반환하지 않습니다.

```text
화면 (page.jsx / components)
  → store.jsx, ai.js, exhibitions.js
  → app/api 경로
  → server/*-handlers.ts (요청 검증·인증·DTO)
  → Supabase RPC / server/core (GPT·작업 처리·Storage)
```

기존 `core/jobs.ts`의 작업 선점 토큰, 중간 결과 저장, 중복 실행 제한, 실패 복구 흐름을 유지합니다. 프론트는 서버에 날짜와 요청 ID를 보내며, 서버가 본인 소유로 저장된 조각글·프로필을 다시 조회해 그림을 생성합니다. 클라이언트가 보낸 프롬프트나 이미지 파일 경로를 저장하는 구조가 아닙니다.

| 기존 DB/백엔드 | 프론트에 제공하는 값 |
|---|---|
| Supabase Auth 사용자 | `account.email`, `joinedAt`, `kind`, `provider` |
| `profiles.id`, `nickname`, `art_style`, `ai_consent_at` | 인증 사용자 ID로 조회한 `profile.nick`, `style`, `consent` |
| `profiles.onboarded` | 프로필 입력 전에는 `profile:null` |
| `profiles.deleting_at` | `deletionPending:true`; 일반 변경 차단, 삭제 재시도 화면 유지 |
| `entries.content`, `created_at`, `entry_date` | `Entry.text`, `at`, 날짜별 `drafts` 또는 그림의 `entries` |
| `daily_artworks.artwork_date`, `scene_summary`, `status` | `Artwork.date`, `summary`, `status` |
| `daily_artworks.image_path` | 본인에게는 1시간 서명 URL, 공개 전시에는 접근 검사 이미지 경로 |
| `daily_artworks.last_request_id` | 본인 응답의 `requestId`; 응답 유실 시 요청 결과 구분 |
| `exhibitions` + `exhibition_items` | 하나의 `exhibition`과 정렬된 `dates` |

그림체는 프론트 `water`를 DB `watercolor`로 변환합니다. `pencil`, `crayon`, `story`는 그대로 사용하며, 기존 `gouache`도 읽기·생성 호환을 유지합니다. 신규 선택 UI는 조원의 4종 구성을 유지합니다.

## 실행과 설정

```bash
npm ci
npm run dev
```

접속은 `http://127.0.0.1:3001`입니다. 다른 원본 프로젝트의 개발 서버와 구분하는 포트입니다. `APP_URL`과 실제 접속 origin이 다르면 변경 요청은 `403`이 됩니다.

현재 작업 폴더의 `.env.local`은 기존 프로젝트 설정을 복사해 두었습니다. 값을 문서·채팅·Git에 넣거나 예제 파일로 덮어쓰지 않습니다. 새 환경에서만 `.env.example`을 참고해 아래 이름을 설정합니다.

| 환경변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 공개 연결 키 |
| `SUPABASE_SECRET_KEY` | 서버 전용 관리자 키: 계정 정리·작업 처리·공개 전시 접근 검사 |
| `APP_URL` | 현재 실행 환경의 origin. 로컬은 `http://127.0.0.1:3001` |
| `OPENAI_API_KEY` | 서버 전용 GPT 호출 키 |
| `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` | 기존 프로젝트의 모델 설정 유지 |
| `CRON_SECRET` | 작업 호출 인증용 서버 전용 공통 비밀값, 32자 이상 |

팀 코드 호환용 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` 및 관리자 키 별칭 `SUPABASE_SERVICE_ROLE_KEY`도 지원합니다. 둘을 함께 설정하면 `NEXT_PUBLIC_*` 및 `SUPABASE_SECRET_KEY`를 우선 사용합니다. OAuth 제공자 비밀값은 Supabase 제공자 설정에서 관리합니다.

운영 `APP_URL`은 `https://harujogak-hihellow18.vercel.app`이며 기존 Vercel 운영 값을 유지했습니다. Node.js 24·`sin1`에 배포했고 `vercel.json`의 `crons:[]`로 Vercel 예약 작업을 추가하지 않습니다. 예약은 기존 Supabase Cron이 담당합니다. `.vercelignore`는 환경 파일·로컬 빌드·테스트·문서 등을 배포 업로드에서 제외합니다. 임시 배포 URL에서 브라우저 변경 요청을 보내면 운영 `APP_URL`과 달라 `403`이 발생할 수 있습니다.

이번 배포는 MCP에서 기존 팀·프로젝트를 지정했습니다. `.vercel/project.json`과 Git push 자동 배포는 설정하지 않았으므로, 이후 CLI 배포 전에는 기존 프로젝트 연결과 대상을 확인합니다.

기존 운영 DB를 연결하면 로컬 실행도 같은 데이터를 읽고 변경합니다. 현재 연결 DB에는 통합에 필요한 추가 컬럼·RPC를 적용했습니다. 다른 DB를 사용하는 팀원은 해당 환경의 스키마·적용 이력을 별도로 확인합니다. 실제 데이터 쓰기 전에는 연결 대상을 확인합니다.

## DB 마이그레이션과 운영 전환

기존 운영 DB에 이미 존재하는 스키마·작업 설정에 대응하는 파일은 다음 3개입니다.

1. `202611040001_initial.sql`
2. `20261104145839_automatic_artwork_worker.sql`
3. `20261104150624_seal_worker_bootstrap.sql`

**기존 DB에는 이번 추가 파일 1개만 적용했습니다. 이전 3개와 이번 파일을 다시 실행하지 않습니다.** 초기 스키마는 이미 존재하지만 `202611040001_initial.sql`은 원격 마이그레이션 이력에 등록되어 있지 않습니다. 이번 적용 전 원격 이력에는 작업 처리기 파일 2개만 있었고, 지금은 `team_frontend_integration` 이력이 추가되었습니다. 따라서 로컬·원격 이력을 정리하지 않은 채 모든 파일을 `db push` 하지 않습니다.

새 개발용 Supabase DB의 기본 경로는 `202611040001_initial.sql` 다음에 `20261111104704_team_frontend_integration.sql`을 적용하는 것입니다. 이 경우 자동 예약은 아직 설정되지 않습니다. 두 자동 작업 파일을 그대로 포함해 4개를 일괄 실행하지 않습니다. `automatic_artwork_worker`는 기존 운영 URL을 포함하고, `seal_worker_bootstrap`은 Vault 비밀값이 이미 준비되어 있어야 합니다. 새 환경의 자동 작업은 호출할 배포·Vault·Cron을 별도로 준비한 뒤 설정합니다.

이번 추가 파일은 `20261111104704_team_frontend_integration.sql`입니다. 원격 적용 버전 `20261111104704`, 이름 `team_frontend_integration`에 로컬 파일명을 맞췄습니다. 주요 변경은 프로필 입력·삭제 상태, 새 그림체, 장면·태그·요청 ID, 조각글 저장·수정 RPC, 그림 재요청, 전시 저장, 계정 삭제 준비 및 큐레이터 한도입니다. 삭제 중 계정은 기존 RPC를 통한 쓰기도 차단하며, 작업 선점과 날짜별 잠금 구조를 유지합니다.

적용 직후 확인한 결과는 다음과 같습니다. 이후 실제 사용으로 행 수는 달라질 수 있습니다.

- 기존 행 수 유지: `profiles` 1, `entries` 4, `daily_artworks` 2, `exhibitions` 0
- 확장 컬럼 5개 및 `ai_daily_usage`의 RLS·권한 확인
- 기존 Cron 활성 상태(`enabled=true`) 유지, 확인 시 대기·처리 중 작업 없음

이후 11월 11일 실제 생성 검증으로 합성 조각글 1개·수채화 그림 1개가 추가되어 조각글 5개·그림 3개가 되었습니다. 기존 조각글 4개·그림 2개는 보존했으며, 검증 후에도 Cron 활성 상태와 대기·처리 중 작업이 없음을 확인했습니다.

2026-11-11 20:10:56.678(KST)에 새 통합 배포가 READY가 되었고 운영 주소가 새 배포를 가리키는 것을 확인했습니다. 새 UI와 `/api/jobs`는 같은 배포로 교체했습니다. 20:12:46(KST)의 인증된 빈 작업 POST는 `200 {processed:false}`를 반환했습니다. 이는 실제 HTTP 응답으로 확인한 결과이며 MCP 런타임 로그에서 관측한 기록은 아닙니다.

Cron 호출 URL은 `https://harujogak-hihellow18.vercel.app/api/jobs` 그대로여서 별도 SQL 변경 없이 새 handler를 사용합니다. 20:12:18(KST)의 DB 확인에서는 활성 1분 Cron 1개·`enabled=true`·마지막 tick 20:12 `idle`, 대기·처리 중·전송 중·실패·중복 건수 0, 프로필 1개·조각글 5개·완성 그림 3개를 확인했습니다. 이 배포 점검 시점에는 SMTP·OAuth 설정을 변경하지 않았으며, Gmail SMTP 전환은 이후 작업입니다.

새 worker는 `crayon`·`story`를 포함한 그림체를 지원하며, 운영에서 크레파스 재생성·동화책 자동 생성·색연필 생성과 PNG 다운로드를 실제 확인했습니다. 만료 선점 복구는 과거 날짜 시험 자료와 의도적으로 오래된 선점을 사용했으며, 실제 자정 통과·프로세스 강제 종료 시험은 아닙니다. 이전 배포로 복구할 때는 현재 DB와 새 그림체에 대한 호환성을 함께 확인합니다.

## 인증과 메일

서버는 Supabase 사용자 검증 후 본인 데이터를 조회합니다. 세션 쿠키는 HttpOnly이며, 운영에서는 Secure, SameSite=Lax를 사용합니다. 브라우저의 쓰기 요청은 `APP_URL` origin을 검사합니다. 비밀번호 변경은 현재 비밀번호를 다시 확인합니다.

인증 경로는 다음과 같이 나뉩니다.

| 경로 | 용도 |
|---|---|
| `/api/auth/oauth/kakao`, `/api/auth/oauth/google` | 소셜 로그인 시작 |
| `/api/auth/callback` | 소셜 PKCE 콜백. 신규 프로필은 `/profile`, 완료 사용자는 `/today` 또는 검증한 내부 경로 |
| `/auth/callback` | 기존 이메일 PKCE 콜백 호환. 성공 시 `/today` |
| `/auth/confirm?type=email&token_hash=…` | 현재 이메일 인증 템플릿. 성공 시 `/today` |
| `/auth/confirm?type=recovery&token_hash=…` | 현재 비밀번호 재설정 템플릿. 검증 후 `/reset-password` |

재설정은 인증된 복구 링크를 통과한 세션에만 10분짜리 서명된 복구 권한을 부여합니다. 일반 로그인 세션만으로 재설정 API를 호출할 수 없습니다. 메일이 단순히 `/reset-password`로 이동하도록 기본 템플릿을 바꾸면 이 흐름과 맞지 않을 수 있으므로, 실제 Supabase 템플릿의 `token_hash`·`type=recovery` 경로를 확인합니다. 비밀번호 재설정 요청 응답은 계정 존재 여부나 실제 발송 성공을 공개하지 않습니다.

로컬 OAuth 검증 전에 Supabase Redirect URLs에 `http://127.0.0.1:3001/api/auth/callback`을 등록하고 카카오·구글 제공자 활성화와 제공자 콘솔의 Supabase 콜백 설정을 확인합니다. 이메일 PKCE 흐름을 쓴다면 `/auth/callback`도 확인합니다. 기존 운영 Site URL을 로컬 주소로 일괄 변경하지 않습니다. 현재 메일 템플릿이 Site URL을 사용하면 링크는 운영으로 이동할 수 있으므로 테스트 환경에 맞는 템플릿·주소를 확인해야 합니다.

현재 발신 설정은 Supabase의 Gmail SMTP(`smtp.gmail.com:465`)입니다. 사용자가 Google 2단계 인증을 준비하고 앱 비밀번호를 Supabase에 직접 입력했으며, 저장 후 다시 열어 발신자·호스트·포트를 확인했습니다. 앱 비밀번호는 읽거나 복사하지 않았고 `.env`에도 추가하지 않았습니다. 기존 Resend 계정·키는 삭제하지 않았습니다. 가입·이메일 인증은 활성 상태이며 실제 프로젝트 한도는 시간당 30통·동일 수신자 최소 60초 간격으로 유지했습니다. 발신 계정과 다른 사용자 소유 주소의 메일 수신을 사용자가 확인했고, Auth 메타데이터에서도 해당 계정의 이메일 인증과 프로필 입력 완료를 확인했습니다.

Site URL과 가입·복구 메일의 `token_hash`/`type=email|recovery` 링크는 유지했습니다. 현재 redirect 목록은 기존 `http://127.0.0.1:3000/auth/callback`과 운영 `/auth/callback`이며, 로컬 3001 및 OAuth 경로 등록 완료를 뜻하지 않습니다. Google·Kakao 제공자는 현재 비활성입니다. 소셜 콜백의 기존 이메일 계정 연결 거부 정책은 코드에 유지하지만 실제 OAuth 동작은 별도 준비·검증 대상입니다.

Gmail은 무제한 발송 수단이 아니며 Google 비밀번호를 바꾸면 앱 비밀번호가 폐기되어 다시 설정해야 합니다. [Gmail 발송 제한](https://support.google.com/mail/answer/22839), [Google 앱 비밀번호 안내](https://support.google.com/accounts/answer/185833). 가입 성공을 오류와 구분하는 UI는 20:59:45(KST)에 운영 배포했고, 실제 가입 요청 후 정상 상태 안내·이메일 유지·비밀번호 비움·버튼 재활성화를 확인했습니다. 수신 확인은 사용자 보고, 인증 확인은 Auth 메타데이터에 근거하며 받은편지함이나 SMTP 로그를 직접 읽은 것은 아닙니다. 사용자가 새 계정의 비밀번호 로그인을 완료했다고 보고했고, 운영 `/today`의 로그인 상태·활성 입력과 `/me`의 기록 0개·그림 0개를 직접 확인했습니다. 이 SMTP 시험 당시 글 저장·GPT 생성은 실행하지 않았으며, 후속 자동 작업 시험에서 수행했습니다. 상세 내용은 [SMTP 검증 기록](gmail-smtp-verification-2026-11-11.md)에 있습니다.

## API 계약

JSON 변경 요청은 `Content-Type: application/json`과 동일 origin을 사용합니다. 사용자 인증은 쿠키로 전달하며 사용자 ID를 요청 본문으로 받지 않습니다. 아래 `DB`, `Artwork` 등의 상세 모양은 `src/lib/types.js`를 참고합니다. 출력 계약의 실제 구현은 `src/server/data.ts`와 각 handler입니다.

| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/auth/signup` | `{email,password}` | `{ok:true,confirm:boolean}`; `confirm`은 이메일 확인 필요 여부 |
| `POST /api/auth/login` | `{email,password}` | `{ok:true}` |
| `POST /api/auth/logout` | 본문 없음 | `{ok:true}` |
| `POST /api/auth/forgot-password` | `{email}` | `{message}`; 계정 존재·발송 여부와 무관한 안내 |
| `POST /api/auth/reset-password` | `{password}` | 복구 권한 확인 후 `{ok:true}`; 다시 로그인 |
| `GET /api/me` | 없음 | `DB` |
| `PUT /api/me/profile` | `{nick,style,consent}` | `{ok:true}`; `consent` 필수 boolean |
| `PUT /api/me/password` | `{current,next}` | `{ok:true}`; 이메일 계정만 지원 |
| `DELETE /api/me` | 이메일 `{password}`, 소셜 `{confirm:"탈퇴"}` | 정리 완료 시 `{ok:true}` |
| `POST /api/me/entries` | `{date,entry:{id,text}}` | `{entry:Entry}`; `id`는 UUID |
| `PATCH /api/me/entries/[id]` | `{text}` | `{ok:true}` |
| `DELETE /api/me/entries/[id]` | 본문 없음 | `{ok:true}` |
| `POST /api/artworks` | `{date,redraw?,requestId}` | `{artwork:Artwork}`; UUID `requestId` 필수 |
| `GET /api/artworks/[date]` | 없음 | `{artwork:Artwork}` |
| `PATCH /api/me/exhibition` | `{dates?,isPublic?}` 중 하나 이상 | `{ok:true,id}` |
| `GET /api/exhibitions/[id]` | 없음 | `PublicExhibition`; 비공개는 본인만 |
| `GET /api/exhibitions/[id]/images/[date]` | 없음 | 공개 상태·선택·소유권 검사 후 이미지 |
| `POST /api/curate` | `{dates}` | `{headline,body}` |
| `POST /api/me/artworks/[date]/song` | 미구현 | 인증 사용자에게 `501` |
| `POST /api/me/songs/[id]/feedback` | 미구현 | 인증 사용자에게 `501` |
| `POST /api/jobs` | 서버의 `Authorization: Bearer …` | 작업 처리 결과; 브라우저 사용 API가 아님 |

옛 `POST /api/summarize`, `/api/draw`, `/api/me/artworks`, `/api/me/artworks/[date]/redraw` 계약은 사용하지 않습니다. 서버의 `/api/artworks`가 요약·그림·저장을 관리합니다. `/api/curate`도 클라이언트 요약문을 받지 않고 날짜로 본인 저장 자료를 조회합니다.

일반 JSON API 오류는 `{error:string}`입니다. 잘못된 입력 `400`, 비로그인 `401`, origin·권한 거부 `403`, 없는 자료 또는 타인의 비공개 전시 `404`, 상태 충돌 `409`, 본문 크기 초과 `413`, 한도 초과 `429`, 미구현 `501`, 외부 연결·서버 처리 실패 `503`을 구분합니다. 그림 시도 제한 등 DB 업무 규칙은 `409`일 수 있습니다. `/api/jobs`의 인증 실패는 일반 사용자 JSON 계약과 별개입니다.

## 저장·생성·공개 동작

조각글은 서울 날짜 기준 오늘에만 작성·수정하며, 1~500자·하루 30개 제한과 마감 후 변경 금지를 DB에서도 검사합니다. 작성 시각은 서버 값을 사용하고 클라이언트의 사용자 ID·위치·시각을 신뢰하지 않습니다. 프론트는 저장·수정·삭제의 진행을 기다린 뒤 그림 생성을 요청합니다. 저장이 실패한 채 그림 생성을 성공으로 진행하지 않습니다.

그림 `status`는 `queued → processing → ready` 또는 `failed`입니다. 화면용 `phase`는 처리 중 `summarizing`·`drawing`을 구분합니다. `202`는 대기·처리 중이며, `200`에도 `failed`가 올 수 있으므로 **HTTP 성공만으로 그림 완성을 판단하지 않습니다.** 네트워크·서버 응답 유실 시 같은 날짜를 조회하되 `requestId`가 일치하는 결과만 이번 요청으로 해석합니다. 명시적인 `4xx` 오류를 과거 그림으로 덮지 않습니다.

하루 그림 하나의 총 작업 선점 횟수는 다시 그리기·재시도를 포함해 3회입니다. 날짜가 바뀌어도 해당 그림의 시도 횟수가 초기화되지 않습니다. 큐레이터는 완성 그림 3장 이상을 기준으로 서버에서 자료를 조회하며 사용자별 서울 날짜당 8회 예약 한도를 적용합니다. 호출 이후 실패해도 예약한 사용량은 반환하지 않습니다. 그림·큐레이터는 AI 전송 동의가 필요합니다.

예약 작업은 지난 날짜의 기록을 대기 상태로 넣고, 작업 처리기가 한 건씩 처리합니다. 선점 후 10분을 넘긴 처리 작업은 시도 한도 내에서 다시 선점할 수 있지만 일반 `failed` 작업은 자동 재시도하지 않습니다. 토큰으로 오래된 실행의 DB 완료 쓰기를 막지만, 외부 API 호출·과금까지 정확히 한 번만 발생한다고 보장하지는 않습니다. 운영에서는 의도적으로 오래된 선점의 복구를 확인했으며, 실제 프로세스 강제 종료·업로드 이후 장애 시험과는 구분합니다. 열린 화면에 기존 대기 작업이 없으면 새 Cron 작업 발견에 새로고침이나 탭 복귀가 필요할 수 있습니다.

본인 그림 URL은 비공개 Storage의 1시간 서명 URL입니다. 개별 그림 조회에서 저장된 파일의 URL을 만들지 못하면 `503`으로 알립니다. 전체 조회는 해당 그림의 `imageError:true`를 표시해 파일 로드 문제를 구분합니다. `ready`라도 이미지 로드 오류를 예시 그림 생성 성공으로 처리하지 않습니다.

전시는 현재 사용자별 첫 전시 하나를 사용합니다. 선택은 최대 100장, 중복 없는 본인 완성 그림이며 순서를 보존합니다. 공개 응답에는 닉네임·선택 그림·요약·캡션만 포함하고 원문 조각글·이메일·사용자 ID·프롬프트·Storage 경로를 넣지 않습니다. 공개 이미지 링크는 매 요청 공개 여부와 선택 상태를 다시 검사하므로 비공개 전환 후 기존 링크로 새로 조회할 수 없습니다. 이미 내려받은 이미지까지 회수하는 기능은 아닙니다.

탈퇴는 대기·처리 중 작업이 있으면 먼저 완료를 기다리게 합니다. 삭제 준비 이후 기록 쓰기를 차단하고 Storage 정리가 성공한 뒤 Auth 사용자를 삭제합니다. 중간 실패 시 `GET /api/me`가 `deletionPending:true`로 반환해 재시도를 유지합니다. 아주 오래된 작업의 늦은 외부 업로드까지 잔여 파일이 절대 없다고 보장하는 구조는 아니므로 운영 정리 검증에 포함합니다.

## 다른 API 담당 조원에게 전달할 연결점

`GET /api/me`의 `capabilities.music`은 `false`이고, `capabilities.weather`는 서버에 `KMA_SERVICE_KEY`가 있을 때만 `true`입니다(2026-11-12 추가, 현재 운영에는 키·마이그레이션 미적용이라 `false`).

날씨는 독립 라우트 없이 `POST /api/me/entries`에서 처리합니다. 기능이 켜져 있고 사용자가 위치를 허용하면 프론트가 소수점 2자리 `lat`, `lon`을 함께 보내고, 서버(`src/server/weather.ts`)가 기상청 초단기예보를 격자 번호로 조회해 `set_entry_weather` RPC로 조각글에 `weather_code`, `temp_c`를 한 번 기록합니다. 응답의 `Entry.weather`는 `{weather,tempC}` 또는 `null`입니다. 좌표는 저장·기록하지 않고, 조회 실패·한국 밖 좌표·위치 거부는 날씨 없이 저장합니다. 그림 생성 입력(`entry_snapshot`)에는 날씨를 넣지 않습니다. 화면은 오늘·그림 자세히 보기의 조각글 시각 아래에 아이콘과 기온을 표시합니다(`src/components/Weather.jsx`). **켜는 순서: `supabase/migrations/20261112003000_entry_weather.sql` 적용 → `KMA_SERVICE_KEY` 설정.** 키를 먼저 넣으면 없는 컬럼을 조회해 `/api/me`가 실패합니다.

음악의 두 경로는 `501`이며 `Artwork.song`, `mood`와 공개 전시의 `song`은 `null`입니다.

실제 API를 구현할 때 제공자 키는 서버에 두고, 응답 DTO·DB 보관 범위·한도·실패 처리를 합의한 뒤 해당 capability를 켭니다. 음악 카드의 후보 필드(`id`, `videoId`, `title`, `channel`)는 `types.js`에 참고용으로 남기지만 현재 DB에 `song_pool`이 있다고 가정하지 않습니다. 위치·외부 서비스 전송 범위가 바뀌면 개인정보처리방침도 실제 동작과 맞춰 검토합니다.

## 검증과 남은 확인

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`tests/`의 Vitest는 원본 작업 처리·AI 응답·DB 정책과 추가 API·복구 인증·클라이언트 흐름을 검사합니다. DB 시험은 PGlite를 사용하며, 실제 Supabase 서비스의 Auth·Storage·Cron 실행을 대신하지 않습니다. Node 테스트는 프론트 유틸리티와 OAuth 규칙을 검사합니다. 최종 테스트 수는 실행 결과를 기준으로 확인합니다.

로컬에서 로그인·가입 모드·비밀번호 재설정 진입 화면을 확인했습니다. 비로그인 `/api/me`, `/api/artworks/[date]`의 `401`과 잘못된 전시 ID의 `404`도 확인했습니다.

2026-11-11에는 사용자가 3001번 로컬 새 UI에서 기존 계정에 실제 로그인한 뒤, 브라우저 조작으로 그날의 첫 조각글인 연결 검증용 합성 기록 1개를 저장하고 `watercolor` 그림을 생성했습니다. 첫 시도에 약 20.6초 만에 `ready`가 되었으며 갤러리의 그림 3장·조각글 5개와 새로고침 후 이미지 유지를 확인했습니다.

DB에서는 `scene=park`, 태그 5개, 요약·프롬프트·이미지 경로의 저장을 확인했고, 실제 Storage 객체와 버킷의 `public=false`도 확인했습니다. 기존 조각글 4개·그림 2개는 보존했고 Cron은 활성·유휴 상태를 유지했습니다. 생성 시각은 19:56:29.309, 선점은 19:56:29.758, 완료는 19:56:49.924(KST)입니다. **검증용 글·그림은 사용자 계정에 남아 있으며 11월 11일 기록은 마감되었습니다.** 상세 증거는 [라이브 검증 기록](live-verification-2026-11-11.md)에 정리합니다.

배포 직후에는 비로그인 화면·접근 제한·인증된 빈 worker 호출만 확인했습니다. 그 이후 사용자가 운영에 로그인했고, 갤러리의 실제 그림 3장·조각글 5개를 확인했습니다. UI에서 프로필을 크레파스로 저장하고 11월 11일 그림을 정확히 한 번 다시 그렸습니다. 처리 중 표시와 버튼 비활성화, 새 크레파스 이미지와 전체 새로고침 후 유지까지 확인했습니다.

재생성은 20:39:19.425 선점 → 20:39:36.842 완료(KST), 약 17.4초였고 `ready`, `attempts=2`입니다. 요약·크레파스 프롬프트·태그 5개·실제 비공개 Storage 파일을 확인했습니다. 이전 두 그림과 조각글 5개의 지문은 변하지 않았습니다. 프로필 기본 그림체는 UI로 수채화에 복원했으며 20:40:53(KST)의 DB 확인에서도 동의·프로필 완료 상태와 함께 유지됐습니다. 11월 11일 그림은 크레파스로 남고 해당 날짜의 생성 시도는 1회 남았습니다. 상세 증거는 [운영 흐름 검증](production-flow-verification-2026-11-11.md)에 있습니다.

위 크레파스 시험 당시에는 오늘 기록이 이미 마감돼 새 글을 저장하지 않았습니다. 이후 새 계정으로 운영 UI에서 합성 조각글 2개를 저장하고 각각 11월 10일·9일로 날짜를 조정했습니다. A는 자연 Cron이 최초 생성했고, B는 GPT를 실행하지 않은 첫 선점을 만들어 활성 보호를 확인한 뒤 선점 시각만 오래되게 바꾸어 자연 Cron의 재선점·완료를 확인했습니다. 두 동화책 이미지의 실제 파일·상세 새로고침·갤러리 그림 2장/조각글 2개, 두 전송의 HTTP `200`/`ready`와 기존 자료 지문 유지를 확인했습니다. 이 자동 작업 시험에서는 앱 코드·스키마·배포 설정을 변경하지 않았습니다. 상세 시각과 한계는 [자동 작업 검증](automatic-worker-verification-2026-11-11.md)에 있습니다.

후속 시험에서는 오늘 조각글의 UI 저장·수정·새로고침 유지, 색연필 최초 생성·실제 PNG 다운로드, 3장 큐레이터의 GPT 해설·사용량 1을 확인했습니다. 운영 UI에서 전시 2장 선택·순서·공개 뷰어·링크 복사·비공개 전환 후 기존 익명 JSON/이미지 링크 `404`도 확인했습니다. 별도 임시 계정 2개의 운영 API 검사 53개는 본인 CRUD·계정 간 접근 차단·자기 탈퇴 후 Auth/DB/Storage 정리까지 통과했습니다. 임시 계정은 모두 제거했으며 기존 두 계정에는 이 API 시험으로 로그인하거나 쓰지 않았습니다. 최신 전체 테스트 125개(Vitest 92·Node 33), lint·타입 검사·빌드를 통과했고 UI 수정본을 운영 배포했습니다. 전시의 실패 항목 해제는 합성 그림 상태를 잠시 바꾼 통제 시험 후 원래 상태로 복원했습니다. 프로필 첫 조회 `503` 복구·Storage 장애·시도 한도는 React/모의/로컬 DB 검증이며 실제 provider 장애를 주입하지 않았습니다. [추가 기능 검증](remaining-features-verification-2026-11-11.md)에 범위를 기록합니다. 다음 항목은 실제 환경에서 확인해야 합니다.

- 실제 자정 경과에 따른 마감과 대기 작업 발견 화면 동작
- 새 SMTP의 비밀번호 복구와 실제 로그아웃 흐름
- 카카오·구글의 실제 제공자 로그인·신규 프로필·연결 충돌 정책
- 저장 도중 마감, 생성 실패 및 시도 한도의 실제 운영 처리
- 실제 프로세스 중단·업로드 이후 장애, 운영에서 마지막 시도 소진 처리
- 실제 Storage 장애 후 탈퇴 재시도와 아주 늦은 작업의 업로드 경합
- 새 SMTP의 비밀번호 복구, OAuth 제공자·운영 리디렉션, 날씨·음악 등 추가 API 통합

`backend-handoff.md`, JavaScript 전환 안내, `social-login-setup.md`, 기존 개인정보 검토 문서 및 `specs/`의 옛 스키마·실험용 `webTest` 설명은 참고 자료입니다. 현재 계약은 이 문서·`src/lib/types.js`·실제 handler 및 추가 마이그레이션을 기준으로 맞춥니다. 원본 백엔드 폴더는 보존했고, 기존 운영 주소의 UI·worker는 이 통합본으로 교체했습니다.
