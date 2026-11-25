// 현재 프론트/API DTO 문서. 런타임 코드나 DB 스키마가 아닙니다.
// 실제 응답 구현: src/server/data.ts, src/server/*-handlers.ts.
// DB 컬럼과 응답 이름은 다릅니다. 예: content -> text, watercolor -> water.
// 날짜는 서울 기준 YYYY-MM-DD, 시각은 ISO 문자열입니다.
// 기존 실험용 /api/summarize, /api/draw 및 클라이언트 imagePath 저장 계약은 사용하지 않습니다.

/** @typedef {string} DateKey YYYY-MM-DD */
/** @typedef {"day"|"cat"|"rain"|"park"|"cafe"|"night"} Scene */
/** @typedef {"water"|"pencil"|"crayon"|"story"|"anime"|"gouache"} StyleId gouache는 기존 그림 호환용. anime는 화면·DB 값이 같음. */
/**
 * 그림마다 고르는 액자. 화면이 CSS로만 그리고 그림 파일은 그대로. 목록은 src/lib/frames.js.
 * PUT /api/me/artworks/[date]/frame {frame} -> {ok: true, frame}
 * @typedef {"basic"|"diary"|"polaroid"|"wood"|"tape"|"sketch"} FrameId
 */
/** @typedef {"queued"|"processing"|"ready"|"failed"} ArtworkStatus */
/** @typedef {"queued"|"summarizing"|"drawing"|"ready"|"failed"} ArtworkPhase */

/**
 * @typedef {Object} Profile
 * @property {string} nick
 * @property {StyleId} style
 * @property {boolean} consent AI 전송 동의. 프로필 PUT에서 반드시 전달.
 * @property {{gender:"unspecified"|"female"|"male"|"neutral",ageRange:"unspecified"|"child"|"teen"|"20s"|"30s"|"40s"|"50s"|"60plus",occupation:string,appearance:string}} artProfile 선택 입력. 하는 일 80자·외형 200자 이내.
 * @property {boolean} artProfileEnabled AI 동의와 함께 켰을 때 새 그림 요청 시 반영. 기존 그림은 자동 변경하지 않음.
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
 * @property {EntryWeather|null} weather 조각글을 쓴 순간의 기상청 날씨. 위치 거부·조회 실패·기능 비활성 시 null. 좌표는 포함하지 않음.
 */

/**
 * @typedef {"clear"|"cloudy"|"overcast"|"rain"|"rain_snow"|"snow"|"shower"} WeatherCode
 */

/**
 * @typedef {Object} EntryWeather
 * @property {WeatherCode} weather
 * @property {number} tempC 섭씨 기온 (소수점 한 자리).
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
 * @property {boolean} entriesChanged 그림을 그린 뒤 조각글이 더해지거나 고쳐지거나 지워짐(글 내용 기준 비교). 다시 그리기는 지금의 조각글로 그림.
 * @property {Song|null} song 그림에 붙인 YouTube 곡. 아직 고르지 않았거나 기능이 꺼져 있으면 null.
 * @property {null} mood 항상 null. 곡을 고르는 분위기는 서버 DB에만 있음. 저장된 분위기가 없는 그림은 노래 요청 시 기본 calm 목록을 사용함.
 * @property {FrameId} frame 고른 액자. 기본값 basic. 다시 그려도 유지.
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
 * @property {boolean} weather 서버에 KMA_SERVICE_KEY가 있을 때만 true. false면 위치 수집·전송하지 않음.
 * @property {boolean} music 서버에 YOUTUBE_API_KEY가 있고 노래 마이그레이션이 적용됐을 때만 true. false면 음악 API는 501.
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
 * capabilities.weather가 true이고 위치를 허용하면 소수점 2자리로 줄인 lat, lon을 함께 보냄 (날씨 조회에만 쓰고 저장하지 않음).
 * 오늘 날짜에만 보내며, 지난 날에 더한 조각글은 날씨 없이 저장.
 * 수정(PATCH /api/me/entries/[id])·삭제(DELETE)도 같은 날짜 규칙. 삭제 응답 {ok, artworkRemoved}: 그림 있는 날의 마지막 조각글이면 그림도 삭제.
 * @typedef {Object} CreateEntryInput
 * @property {DateKey} date 오늘, 또는 그림이 ready/failed인 지난 날. 그림을 그리는 중(queued/processing)인 날은 409.
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
 * @property {{videoId:string,title:string,channel:string}|null} song 그림에 붙인 곡 (id 없음).
 * @property {FrameId} frame 주인이 고른 액자. 공개 전시의 그림일기 액자에는 날씨를 넣지 않음(응답에도 없음).
 */

/**
 * 그림에 붙인 YouTube 곡 (공용 song_pool의 한 행). 분위기별로 직접 고른 목록(src/server/song-list.ts)에서 나옴.
 * POST /api/me/artworks/[date]/song {reroll?} -> {song: Song|null, unchanged: boolean}
 * POST /api/me/songs/[id]/feedback {vote: 1|-1} -> {ok: true}
 * @typedef {Object} Song
 * @property {number} id song_pool id. 좋아요 요청에 사용.
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
