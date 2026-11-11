// Data shapes used by the screens and by the API. This file is documentation only: it has no code
// and nothing imports it. The backend keeps the same shapes in its own src/lib/types.ts; when an
// API response changes, both must change together.
//
// The shapes mirror the Supabase tables:
// profiles -> Profile, entries -> Entry, daily_artworks -> Artwork, exhibitions(+items) -> Exhibition
//
// How to read a line:
//   @property {string} nick          field `nick` holds a string
//   @property {string|null} note     a string, or null
//   @property {Song|null} [song]     square brackets = the field may be missing
//   @property {Entry[]} entries      an array of Entry
//   {"water"|"pencil"}               exactly one of these strings

/**
 * Example illustration shown when a picture has no drawn image.
 * @typedef {"day"|"cat"|"rain"|"park"|"cafe"|"night"} Scene
 */

/**
 * Drawing style the user picked.
 * @typedef {"water"|"pencil"|"crayon"|"story"} StyleId
 */

// Song recommendation match key (the lists live in the backend: src/server/music/key.ts and supabase/schema.sql).

/** @typedef {"calm"|"upbeat"|"flutter"|"proud"|"lazy"|"tired"|"blue"|"nostalgic"|"busy"|"cozy"} Mood */
/** @typedef {"clear"|"cloudy"|"rain"|"snow"|"hot"|"unknown"} WeatherKey */
/** @typedef {"morning"|"day"|"night"} TimeOfDay */

/**
 * A picture's song (song_pool row).
 * @typedef {Object} Song
 * @property {number} id
 * @property {string} videoId
 * @property {string} title
 * @property {string} channel
 */

/**
 * @typedef {Object} Profile
 * @property {string} nick
 * @property {StyleId} style
 */

/**
 * One fragment (조각글).
 * @typedef {Object} Entry
 * @property {string} id
 * @property {string} at    ISO timestamp
 * @property {string} text
 * @property {EntryWeather|null} [weather]    KMA weather when the fragment was written (location allowed); never coordinates
 */

/**
 * Weather words for a fragment (specs/haru-weather.spl).
 * @typedef {"clear"|"cloudy"|"overcast"|"rain"|"rain_snow"|"snow"|"shower"} WeatherCode
 */

/**
 * @typedef {Object} EntryWeather
 * @property {WeatherCode} weather
 * @property {number} tempC
 */

/**
 * One day's picture.
 * @typedef {Object} Artwork
 * @property {string} date    YYYY-MM-DD
 * @property {Scene} scene    stands in for the image when there is none
 * @property {StyleId} style
 * @property {string} summary    scene_summary from the text AI
 * @property {string[]} tags
 * @property {Entry[]} entries
 * @property {Mood|null} [mood]    picked by the text AI; keys the song recommendation
 * @property {Song|null} [song]    null until one is recommended
 * @property {string} [songQuery]    sent once when saving; never read back
 * @property {string|null} [imagePath]    sent once when saving/redrawing; never read back
 * @property {string|null} [imageUrl]    signed URL (1 hour) of the drawn picture; null/absent = scene placeholder
 * @property {"ai"|"fallback"} [summarySource]    this session only: fallback = AI unavailable, mock summary
 */

/**
 * @typedef {Object} Exhibition
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {boolean} isPublic
 * @property {string[]} dates    ordered artwork dates
 */

// API payloads shared by the client (lib/ai.js) and the server routes (app/api/*).

/**
 * Text AI result: fragments -> one scene description + tags. (POST /api/summarize)
 * @typedef {Object} DaySummary
 * @property {string} summary
 * @property {string[]} tags
 * @property {Scene} scene
 * @property {Mood} mood
 * @property {string} [songQuery]    YouTube search words the text AI wrote (genre/mood only); fixed words when absent
 * @property {string} [imagePrompt]    English scene prompt for the image AI; scene default words when absent
 * @property {"ai"|"fallback"} [source]    fallback = the AI was unavailable and mock answered (shown, not stored)
 */

/**
 * Image AI result. (POST /api/draw)
 * @typedef {Object} Drawing
 * @property {Scene} scene
 * @property {string|null} imagePath    file in the private bucket, saved with the picture
 * @property {string|null} imageUrl    1-hour signed URL to show it now; null = use the scene placeholder
 */

/**
 * Curator commentary input; counting happens before the AI call. (POST /api/curate)
 * @typedef {Object} CurationInput
 * @property {string} periodLabel
 * @property {number} count
 * @property {{ tag: string, count: number }[]} top
 * @property {string[]} summaries
 */

/**
 * Curator commentary result.
 * @typedef {Object} CurationText
 * @property {string} headline
 * @property {string} body
 */

/**
 * Sign-in account (users table); shown on the my page.
 * @typedef {Object} Account
 * @property {string} email    empty for a Kakao account without email consent
 * @property {string} joinedAt    ISO timestamp
 * @property {"email"|"social"} kind    social: no password (password change hidden, delete confirms with '탈퇴')
 * @property {"email"|"kakao"|"google"} provider
 */

/**
 * Everything GET /api/me returns; the store keeps it as `db`.
 * @typedef {Object} DB
 * @property {Account|null} account
 * @property {Profile|null} profile
 * @property {Object<string, Entry[]>} drafts    entries not yet closed, keyed by date
 * @property {Object<string, Artwork>} artworks    keyed by date
 * @property {Exhibition} exhibition
 */

/**
 * GET /api/exhibitions/:id. Public view only: no entries, emails or user ids.
 * @typedef {Object} PublicExhibition
 * @property {string} id
 * @property {string} title
 * @property {string} desc
 * @property {boolean} isPublic    false only in the owner's own preview
 * @property {string|null} ownerNick    null if the owner hasn't set a profile yet
 * @property {PublicArtwork[]} items    in hanging order
 */

/**
 * @typedef {Object} PublicArtwork
 * @property {string} date    YYYY-MM-DD
 * @property {Scene} scene
 * @property {string|null} imageUrl
 * @property {string} summary    scene_summary, shown as the caption when there is no note
 * @property {string|null} note    exhibition_items.note
 * @property {Song|null} song    title/channel/videoId only: the match key (mood, weather) stays private
 */

export {};
