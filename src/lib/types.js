// 현재 프론트/API DTO 문서. 런타임 코드나 DB 스키마가 아닙니다.
// 실제 응답 구현: src/server/data.ts, src/server/*-handlers.ts.
// DB 컬럼과 응답 이름은 다릅니다. 예: content -> text, watercolor -> water.
// 날짜는 서울 기준 YYYY-MM-DD, 시각은 ISO 문자열입니다.
// 기존 실험용 /api/summarize, /api/draw 및 클라이언트 imagePath 저장 계약은 사용하지 않습니다.

/** @typedef {string} DateKey YYYY-MM-DD */
/** @typedef {"day"|"cat"|"rain"|"park"|"cafe"|"night"} Scene */
/** @typedef {"water"|"pencil"|"crayon"|"story"|"gouache"} StyleId gouache는 기존 그림 호환용. */
/** @typedef {"queued"|"processing"|"ready"|"failed"} ArtworkStatus */
/** @typedef {"queued"|"summarizing"|"drawing"|"ready"|"failed"} ArtworkPhase */

/**
 * @typedef {Object} Profile
 * @property {string} nick
 * @property {StyleId} style
 * @property {boolean} consent AI 전송 동의. 프로필 PUT에서 반드시 전달.
 */

/**
 * @typedef {Object} Account
 * @property {string} email 이메일 제공에 동의하지 않은 소셜 계정은 빈 문자열일 수 있음.
 * @property {string} joinedAt ISO timestamp
 * @property {"email"|"social"} kind 비밀번호 변경/탈퇴 확인 방법을 구분.
 * @property {"email"|"kakao"|"google"} provider
 */

/**
 * @typedef {Object} Entry
 * @property {string} id UUID. 클라이언트가 작성 요청 ID로 만들고 DB가 소유권을 확인.
 * @property {string} at 서버 저장 시각 (ISO timestamp).
 * @property {string} text
 * @property {null} weather 날씨 API는 아직 미연결. 현재 항상 null.
 */

/**
 * 본인 전용 그림 응답. image_path, image_prompt, user_id는 응답 필드가 아님.
 * ready와 imageError를 함께 확인해 예시 그림을 생성 성공으로 처리하지 않음.
 * @typedef {Object} Artwork
 * @property {string} id UUID
 * @property {DateKey} date
 * @property {Scene} scene
 * @property {StyleId} style
 * @property {string} summary
 * @property {string[]} tags
 * @property {Entry[]} entries
 * @property {string|null} imageUrl 비공개 Storage 서명 URL (1시간).
 * @property {boolean} imageError 저장된 파일 경로가 있는데 URL을 만들지 못한 상태.
 * @property {ArtworkStatus} status HTTP 200이어도 failed일 수 있음.
 * @property {ArtworkPhase} phase 화면 진행 단계.
 * @property {string|null} error
 * @property {number} attempts 그림별 총 작업 선점 횟수. 다시 그리기 포함 최대 3회.
 * @property {string|null} requestId 마지막 그림 요청 UUID. 본인 응답에만 포함.
 * @property {boolean} canRetry attempts < 3이고 status가 failed 또는 ready인 경우.
 * @property {null} song 음악 API 미연결.
 * @property {null} mood 음악 연동용 분석 미연결.
 */

/**
 * @typedef {Object} Exhibition
 * @property {string} id 저장 전에는 빈 문자열. 첫 저장 후 서버가 반환하는 UUID.
 * @property {string} title
 * @property {string} desc
 * @property {boolean} isPublic
 * @property {DateKey[]} dates 전시 순서. 현재 사용자별 첫 전시 1개를 사용.
 */

/**
 * @typedef {Object} Capabilities
 * @property {boolean} weather 현재 false. 켜기 전에는 위치 수집·전송하지 않음.
 * @property {boolean} music 현재 false. 음악 변경 API는 501.
 */

/**
 * GET /api/me 응답과 클라이언트 store의 db.
 * @typedef {Object} DB
 * @property {Account|null} account 인증된 응답에는 Account, 클라이언트 초기 상태는 null.
 * @property {Profile|null} profile 프로필 입력 완료 전 null.
 * @property {Object<string, Entry[]>} drafts 아직 그림으로 마감되지 않은 날짜별 조각글.
 * @property {Object<string, Artwork>} artworks 날짜별 그림과 실제 작업 상태.
 * @property {Exhibition} exhibition
 * @property {Capabilities} capabilities
 * @property {boolean} deletionPending 삭제 재시도 상태. true이면 drafts/artworks/전시 선택은 비워 반환.
 */

/**
 * POST /api/me/entries. at/weather/사용자 ID는 입력 계약에 없음.
 * @typedef {Object} CreateEntryInput
 * @property {DateKey} date
 * @property {{id:string,text:string}} entry id는 UUID, text는 1~500자.
 */

/**
 * POST /api/artworks. 서버가 저장된 본인 조각글을 조회해 요약·생성·저장.
 * @typedef {Object} GenerateArtworkInput
 * @property {DateKey} date
 * @property {boolean} [redraw] 기본 false.
 * @property {string} requestId UUID. 응답 유실 시 같은 ID 결과만 이번 요청으로 해석.
 */

/**
 * POST /api/artworks 및 GET /api/artworks/[date].
 * POST의 202는 queued/processing. 200도 반드시 artwork.status를 확인.
 * @typedef {Object} GenerateArtworkResult
 * @property {Artwork} artwork
 */

/**
 * PATCH /api/me/exhibition. 적어도 한 필드 필요.
 * @typedef {Object} ExhibitionInput
 * @property {DateKey[]} [dates] 중복 없는 본인 완성 그림 날짜, 최대 100개.
 * @property {boolean} [isPublic]
 */

/**
 * POST /api/curate. 클라이언트 요약·통계·프롬프트는 보내지 않음.
 * @typedef {Object} CurationInput
 * @property {DateKey[]} dates 본인 완성 그림 3장 이상, 입력 최대 100개.
 */

/**
 * @typedef {Object} CurationText
 * @property {string} headline
 * @property {string} body
 */

/**
 * GET /api/exhibitions/[id]. 원문 조각글·이메일·사용자 ID·Storage 경로 없음.
 * @typedef {Object} PublicExhibition
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {boolean} isPublic false인 응답은 본인 미리보기만 가능.
 * @property {string|null} ownerNick
 * @property {PublicArtwork[]} items 전시 순서.
 */

/**
 * @typedef {Object} PublicArtwork
 * @property {DateKey} date
 * @property {Scene} scene
 * @property {string|null} imageUrl /api/exhibitions/[id]/images/[date]; 매 요청 접근 재검사.
 * @property {string} summary
 * @property {string|null} note DB exhibition_items.caption의 화면용 이름.
 * @property {null} song 음악 API 미연결.
 */

/**
 * 다른 API 담당자와 협의할 음악 카드 후보 형태. 현재 서버 응답이나 DB 테이블 계약이 아님.
 * @typedef {Object} Song
 * @property {number} id
 * @property {string} videoId
 * @property {string} title
 * @property {string} channel
 */

/**
 * 일반 JSON API 실패 응답. 인증 콜백 리디렉션과 /api/jobs는 별도 계약.
 * @typedef {Object} ApiError
 * @property {string} error 화면에 표시 가능한 안내.
 */

export {};
