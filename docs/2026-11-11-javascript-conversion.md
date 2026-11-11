# 안내: 프론트 코드를 자바스크립트로 바꿨습니다

- 날짜: 2026-11-11
- 대상: 팀원 전체 (이 저장소를 받아 쓰거나, 전체 앱과 합칠 사람)
- 한 줄 요약: 이 저장소의 코드가 타입스크립트(`.ts`, `.tsx`)에서 자바스크립트(`.js`, `.jsx`)로 바뀌었습니다. **동작은 그대로**이고, 전체 앱(`hjaehyun/webTest`)은 타입스크립트 그대로 둡니다.

## 무엇이 바뀌었나

| 전 | 후 | 비고 |
|---|---|---|
| `src/**/*.tsx` 19개 | `.jsx` | 화면, 컴포넌트, `src/lib/store` |
| `src/**/*.ts` 17개 | `.js` | `src/lib`, `src/server`, 소셜 로그인 라우트, 시험 3개 |
| `src/lib/types.ts` | `src/lib/types.js` | 타입 20개를 **주석으로 적은 설명 문서**로 바꿈. 코드가 없고 어디서도 import하지 않음 |
| `tsconfig.json` | `jsconfig.json` | `@/` 경로 별칭만 남김 |
| `next.config.ts` | `next.config.mjs` | |
| `package.json` | | `typescript`, `@types/node`, `@types/react`, `@types/react-dom` 제거. 시험 명령이 `.test.js`를 돌림 |
| `eslint.config.mjs` | | `next/typescript` 규칙 묶음 제거 |

코드는 타입 표기만 지웠습니다. 예:

```jsx
// 전 (SongCard.tsx)
export default function SongCard({ song, readOnly }: Props) {
  const [opened, setOpened] = useState<string | null>(null);

// 후 (SongCard.jsx)
export default function SongCard({ song, readOnly }) {
  const [opened, setOpened] = useState(null);
```

타입 블록 안에 적혀 있던 설명 주석은 버리지 않고 해당 함수 옆으로 옮겼습니다(예: `src/lib/store.jsx`의 각 기능 설명).

## 바뀌지 않은 것

- 화면 모양과 동작
- 프론트가 부르는 API의 경로, 요청, 응답 (`README.md`의 "프론트가 부르는 API" 표 그대로)
- 폴더 구조와 파일 이름(확장자만 다름)
- 전체 앱(`hjaehyun/webTest`)의 코드: 타입스크립트 그대로

## 각자 할 일

### 이 저장소를 이미 받아 둔 사람

```bash
git pull
```

```bash
npm install
```

- `npm install`을 다시 해야 `typescript` 패키지가 정리됩니다.
- 폴더에 `next-env.d.ts`가 남아 있으면 지워도 됩니다(더 이상 만들어지지 않음).

### 이 저장소에 코드를 더하는 사람

- 새 파일은 `.js`(화면·컴포넌트는 `.jsx`)로, 타입 표기 없이 씁니다.
- 주고받는 데이터 모양이 바뀌면 `src/lib/types.js`의 주석을 같이 고칩니다.
- 올리기 전 확인은 아래 세 가지입니다(`npx tsc --noEmit`은 더 이상 쓰지 않음).

```bash
npm run build
```

```bash
npx eslint .
```

```bash
npm test
```

### 백엔드 담당

1. 전체 앱은 그대로 타입스크립트로 작업하면 됩니다. 바꿀 것 없습니다.
2. **API 응답 모양을 바꿀 때는 꼭 알려 주세요.** 전에는 프론트가 `src/lib/types.ts`를 같이 써서 모양이 어긋나면 타입 오류가 났지만, 이제 프론트는 그 파일을 import하지 않아 **오류로 드러나지 않습니다**. 화면에서 값이 비어 보일 때에야 알게 됩니다.
3. 전체 앱의 `src/lib/types.ts`는 서버 코드가 쓰므로 합칠 때 지우지 말아 주세요.
4. 전체 앱과 합치는 순서는 `README.md`의 "원본에 합칠 때"에 있습니다. 그냥 덮어쓰면 같은 화면 파일이 둘(`page.tsx`, `page.jsx`)이 되니 순서대로 해 주세요. 합친 뒤 전체 앱은 화면(자바스크립트)과 서버(타입스크립트)가 섞이지만, 전체 앱 `tsconfig.json`이 `allowJs: true`라 빌드됩니다.

## 주의할 점 (잃은 것)

- 타입 검사가 없습니다. 필드 이름 오타나 잘못된 값은 화면을 띄워 봐야 드러납니다.
- 편집기 자동 완성이 약해집니다. 데이터에 어떤 필드가 있는지는 `src/lib/types.js`를 보세요.
- `npm test`를 돌리면 `MODULE_TYPELESS_PACKAGE_JSON` 경고가 나옵니다. 바꾸기 전에도 있던 경고이고 결과와 무관합니다.

## 확인한 것

| 항목 | 결과 |
|---|---|
| `npm run build` | 통과 (16 페이지, 바꾸기 전과 같은 목록) |
| `npx eslint .` | 0건 |
| `npm test` | 14/14 |
| 소셜 로그인 라우트 | kakao·google 307, 모르는 제공자 400, code 없는 callback → `/?error=oauth` (바꾸기 전과 같음) |
| 화면 11개 | 임시 가짜 `/api/me` 응답으로 띄워 렌더링 확인 (로그인, 오늘, 갤러리, 그림 상세, 전시회, 그림 고르기, 큐레이터, 마이페이지, 프로필, 가이드, 공개 전시). 임시 파일은 확인 후 삭제 |

확인하지 못한 것: 글쓰기·마감처럼 서버에 저장하는 동작(이 저장소에는 백엔드가 없음), 카카오·구글 로그인 끝까지.

## 되돌리려면

바꾸기 직전 커밋은 `3718c92`입니다. 그 커밋의 파일이 타입스크립트 마지막 상태입니다.
