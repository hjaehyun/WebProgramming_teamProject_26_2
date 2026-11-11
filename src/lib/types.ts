// Shapes mirror the planned Supabase tables so the mock store can be swapped later.
// profiles -> Profile, entries -> Entry, daily_artworks -> Artwork, exhibitions(+items) -> Exhibition

export type Scene = "day" | "cat" | "rain" | "park" | "cafe" | "night";
export type StyleId = "water" | "pencil" | "crayon" | "story";

// Song recommendation match key (lists in src/server/music/key.ts and supabase/schema.sql).
export type Mood = "calm" | "upbeat" | "flutter" | "proud" | "lazy" | "tired" | "blue" | "nostalgic" | "busy" | "cozy";
export type WeatherKey = "clear" | "cloudy" | "rain" | "snow" | "hot" | "unknown";
export type TimeOfDay = "morning" | "day" | "night";

/** A picture's song (song_pool row). */
export type Song = { id: number; videoId: string; title: string; channel: string };

export type Profile = {
  nick: string;
  style: StyleId;
};

export type Entry = {
  id: string;
  at: string; // ISO timestamp
  text: string;
  weather?: EntryWeather | null; // KMA weather when the fragment was written (location allowed); never coordinates
};

/** Weather words for a fragment (specs/haru-weather.spl). */
export type WeatherCode = "clear" | "cloudy" | "overcast" | "rain" | "rain_snow" | "snow" | "shower";
export type EntryWeather = { weather: WeatherCode; tempC: number };

export type Artwork = {
  date: string; // YYYY-MM-DD
  scene: Scene; // stands in for image_url until the image AI is wired up
  style: StyleId;
  summary: string; // scene_summary from the text AI
  tags: string[];
  entries: Entry[];
  mood?: Mood | null; // picked by the text AI; keys the song recommendation
  song?: Song | null; // null until one is recommended
  songQuery?: string; // sent once when saving; never read back
  imagePath?: string | null; // sent once when saving/redrawing; never read back
  imageUrl?: string | null; // signed URL (1 hour) of the drawn picture; null/absent = scene placeholder
  summarySource?: "ai" | "fallback"; // this session only: fallback = AI unavailable, mock summary
};

export type Exhibition = {
  id: string;
  title: string;
  desc: string;
  isPublic: boolean;
  dates: string[]; // ordered artwork dates
};

// API payloads shared by the client (lib/ai.ts) and the server routes (app/api/*).

/** Text AI result: fragments -> one scene description + tags. */
export type DaySummary = {
  summary: string;
  tags: string[];
  scene: Scene;
  mood: Mood;
  songQuery?: string; // YouTube search words the text AI wrote (genre/mood only); fixed words when absent
  imagePrompt?: string; // English scene prompt for the image AI; scene default words when absent
  source?: "ai" | "fallback"; // fallback = the AI was unavailable and mock answered (shown, not stored)
};

/** Image AI result. imageUrl stays null until a real image provider is wired up. */
export type Drawing = {
  scene: Scene;
  imagePath: string | null; // file in the private bucket, saved with the picture
  imageUrl: string | null; // 1-hour signed URL to show it now; null = use the scene placeholder
};

/** Curator commentary input; counting happens before the AI call. */
export type CurationInput = {
  periodLabel: string;
  count: number;
  top: { tag: string; count: number }[];
  summaries: string[];
};

export type CurationText = { headline: string; body: string };

/** Sign-in account (users table); shown on the my page. */
export type Account = {
  email: string; // empty for a Kakao account without email consent
  joinedAt: string; // ISO timestamp
  kind: "email" | "social"; // social: no password (password change hidden, delete confirms with '탈퇴')
  provider: "email" | "kakao" | "google";
};

export type DB = {
  account: Account | null;
  profile: Profile | null;
  drafts: Record<string, Entry[]>; // entries not yet closed, keyed by date
  artworks: Record<string, Artwork>;
  exhibition: Exhibition;
};

/** GET /api/exhibitions/:id. Public view only: no entries, emails or user ids. */
export type PublicExhibition = {
  id: string;
  title: string;
  desc: string;
  isPublic: boolean; // false only in the owner's own preview
  ownerNick: string | null; // null if the owner hasn't set a profile yet
  items: PublicArtwork[]; // in hanging order
};

export type PublicArtwork = {
  date: string; // YYYY-MM-DD
  scene: Scene;
  imageUrl: string | null;
  summary: string; // scene_summary, shown as the caption when there is no note
  note: string | null; // exhibition_items.note
  song: Song | null; // title/channel/videoId only: the match key (mood, weather) stays private
};
