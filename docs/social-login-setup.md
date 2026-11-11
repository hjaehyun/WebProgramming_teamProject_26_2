# 소셜 로그인 설정 안내 (카카오·구글)

SPL `haru-social-login` rev 1, 설정안내 단계. 키(Client Secret)는 **Supabase 대시보드에만** 넣는다. 앱 코드·`.env.local`·Vercel env에는 넣지 않는다.

먼저 Supabase 대시보드 **Authentication > Sign In / Providers > Kakao**(또는 Google)를 열어 **Callback URL**을 복사해 둔다.
형식: `https://<project-ref>.supabase.co/auth/v1/callback` (카카오·구글 둘 다 이 주소 하나)

---

## 1. 카카오 (Kakao Developers)

1. https://developers.kakao.com 로그인 → **앱** → **앱 생성** (이름 "하루조각", 카테고리 아무거나)
2. **앱 설정 > 앱 > 플랫폼 키**: **REST API 키** 복사 → Supabase의 *Client ID*
3. REST API 키 편집 화면:
   - **카카오 로그인 Redirect URI**에 위 Supabase Callback URL 붙여넣고 저장
   - **카카오 로그인 Client Secret** 코드 복사 → Supabase의 *Client Secret*, 그리고 **사용 ON**
4. **제품 설정 > 카카오 로그인 > 일반**: 사용 설정 **상태 ON**
5. **제품 설정 > 카카오 로그인 > 동의항목**: `닉네임(profile_nickname)`, `프로필 사진(profile_image)` 켜기
   - `카카오계정(이메일)(account_email)`은 비즈 앱만 가능 → 지금은 **켜지 않는다**
6. (웹 플랫폼 도메인을 묻는 화면이 있으면) `http://localhost:3000`, `https://dayily-diary-seven.vercel.app`

## 2. 구글 (Google Cloud Console)

1. https://console.cloud.google.com → 프로젝트 선택/생성 → **Google Auth Platform**
2. **Branding**: 앱 이름 "하루조각", 지원 이메일
3. **Audience**: 외부(External), 테스트 단계면 **테스트 사용자**에 로그인할 구글 계정 추가
4. **Data Access**: `openid` 추가 (email·profile은 기본)
5. **Clients > Create client > 웹 애플리케이션**
   - 승인된 JavaScript 원본: `http://localhost:3000`, `https://dayily-diary-seven.vercel.app`
   - 승인된 리디렉션 URI: **Supabase Callback URL** (앱 주소 아님)
6. Client ID, Client Secret 복사

## 3. Supabase 대시보드

1. **Authentication > Sign In / Providers > Kakao**
   - Enabled ON, Client ID = REST API 키, Client Secret = 카카오 Client Secret
   - **Allow users without an email ON** (이메일 동의를 안 받으므로)
   - Save
2. **… > Google**: Enabled ON, Client ID, Client Secret → Save
3. **Authentication > URL Configuration**
   - Site URL: `https://dayily-diary-seven.vercel.app` (이미 있으면 그대로)
   - Redirect URLs에 추가:
     - `http://localhost:3000/api/auth/callback`
     - `https://dayily-diary-seven.vercel.app/api/auth/callback`
4. "Manual linking"은 **켜지 않는다** (앱이 충돌을 직접 거부)

## 같은 이메일 처리 (기준확인 결정, 2026-11-08)

Supabase는 같은 이메일이면 소셜 계정을 기존 이메일 계정에 자동 연결하고, 이 동작을 끌 수 없다. 이메일 인증이 꺼져 있어 남이 내 주소로 먼저 이메일 가입해 두면 내 구글 로그인이 그 계정에 붙을 수 있다.
→ **앱에서 거부**: 콜백에서 계정에 이메일 로그인 수단과 소셜 수단이 함께 있으면 세션을 만들지 않고 로그아웃, 로그인 화면에 "이미 이메일로 가입한 주소예요. 이메일로 로그인해 주세요".
