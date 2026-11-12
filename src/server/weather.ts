import "server-only";
import { z } from "zod";

// Weather at the moment a fragment is written, from the KMA ultra-short-term forecast (초단기예보).
// The browser sends coordinates rounded to ~1 km; they are used for this lookup only and are never
// stored or logged. KMA receives only the 5 km grid cell (nx, ny). Any failure means "no weather".

export type WeatherCode = "clear" | "cloudy" | "overcast" | "rain" | "rain_snow" | "snow" | "shower";
export type EntryWeather = { weather: WeatherCode; tempC: number };
type Item = { category: string; fcstDate: string; fcstTime: string; fcstValue: string };

const ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst";
const TIMEOUT_MS = 2500;

/** The feature is on only when the server has a KMA key. Apply the entry_weather migration before setting it. */
export function weatherEnabled() { return Boolean(process.env.KMA_SERVICE_KEY?.trim()); }

// KMA only covers Korea; anything else (or malformed input) is treated as "no location".
const coordsSchema = z.object({ lat: z.number().min(32).max(39.5), lon: z.number().min(124).max(132) });
export function readCoords(input: unknown) {
  const r = coordsSchema.safeParse(input);
  return r.success ? { lat: Math.round(r.data.lat * 100) / 100, lon: Math.round(r.data.lon * 100) / 100 } : null;
}

/** KMA Lambert conformal conic grid (5 km cells). Seoul City Hall -> (60, 127). */
export function toGrid(lat: number, lon: number) {
  const RE = 6371.00877 / 5, rad = Math.PI / 180;
  const slat1 = 30 * rad, slat2 = 60 * rad, olon = 126 * rad, olat = 38 * rad;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(Math.tan(Math.PI / 4 + slat2 / 2) / Math.tan(Math.PI / 4 + slat1 / 2));
  const sf = (Math.pow(Math.tan(Math.PI / 4 + slat1 / 2), sn) * Math.cos(slat1)) / sn;
  const ro = (RE * sf) / Math.pow(Math.tan(Math.PI / 4 + olat / 2), sn);
  const ra = (RE * sf) / Math.pow(Math.tan(Math.PI / 4 + lat * rad / 2), sn);
  let theta = lon * rad - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) };
}

/** Forecasts are issued at HH:30 (KST) and served from about HH:45; before that, use the previous hour's. */
export function baseTime(now: Date) {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  if (kst.getUTCMinutes() < 45) kst.setUTCHours(kst.getUTCHours() - 1);
  const iso = kst.toISOString();
  return { base_date: iso.slice(0, 10).replaceAll("-", ""), base_time: iso.slice(11, 13) + "30" };
}

const PRECIPITATION: Record<string, WeatherCode> = { "1": "rain", "2": "rain_snow", "3": "snow", "4": "shower", "5": "rain", "6": "rain_snow", "7": "snow" };
const SKY: Record<string, WeatherCode> = { "1": "clear", "3": "cloudy", "4": "overcast" };

/** Uses the nearest forecast hour. Precipitation type wins over sky cover. */
export function toWeather(items: Item[]): EntryWeather | null {
  const nearest = (category: string) => items.filter(i => i.category === category)
    .sort((a, b) => (a.fcstDate + a.fcstTime).localeCompare(b.fcstDate + b.fcstTime))[0]?.fcstValue;
  const temp = nearest("T1H"), tempC = Number(temp);
  const weather = PRECIPITATION[nearest("PTY") ?? ""] ?? SKY[nearest("SKY") ?? ""];
  if (temp === undefined || temp === "" || !Number.isFinite(tempC) || tempC < -60 || tempC > 60 || !weather) return null;
  return { weather, tempC: Math.round(tempC * 10) / 10 };
}

// One KMA call per grid cell and forecast issue, shared by everyone writing nearby.
const cache = new Map<string, Promise<EntryWeather | null>>();

export function lookupWeather(coords: { lat: number; lon: number }, now = new Date()): Promise<EntryWeather | null> {
  const key = process.env.KMA_SERVICE_KEY?.trim();
  if (!key) return Promise.resolve(null);
  const { nx, ny } = toGrid(coords.lat, coords.lon), base = baseTime(now);
  const id = `${base.base_date}${base.base_time}:${nx}:${ny}`;
  const hit = cache.get(id);
  if (hit) return hit;
  if (cache.size >= 300) cache.clear();
  const pending = request(key, base, nx, ny).catch(() => null).then(w => { if (!w) cache.delete(id); return w; });
  cache.set(id, pending);
  return pending;
}

async function request(key: string, base: { base_date: string; base_time: string }, nx: number, ny: number) {
  // data.go.kr issues the same key in an already URL-encoded form too; don't encode that one twice.
  const serviceKey = key.includes("%") ? key : encodeURIComponent(key);
  const query = new URLSearchParams({ pageNo: "1", numOfRows: "60", dataType: "JSON", ...base, nx: String(nx), ny: String(ny) });
  const response = await fetch(`${ENDPOINT}?serviceKey=${serviceKey}&${query}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = response.ok ? await response.json().catch(() => null) : null;
  const items = data?.response?.header?.resultCode === "00" ? data.response.body?.items?.item : null;
  if (!Array.isArray(items)) {
    // Never log the key, the request URL or the location.
    console.warn("[weather] lookup failed", { status: response.status, code: data?.response?.header?.resultCode ?? null });
    return null;
  }
  return toWeather(items);
}
