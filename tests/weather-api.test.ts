import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ userClient: vi.fn(), adminClient: vi.fn(), statelessClient: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/core/supabase/server", () => mocks);
import { entryPost } from "../src/server/entry-handlers";
import { entryColumns, entryView } from "../src/server/data";

const alice = "00000000-0000-4000-8000-000000000001", entryId = "00000000-0000-4000-8000-000000000005";
const date = "2026-11-12", origin = "http://127.0.0.1:3001";
const fetchMock = vi.fn<typeof fetch>();
let saved: Record<string, unknown>;
let setError: unknown;
const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => name === "save_team_entry" ? { data: { ...saved }, error: null } : { data: null, error: setError });
const post = (payload: unknown) => entryPost(new Request(origin + "/api/me/entries", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
const forecast = (t: string, sky: string, pty: string) => Response.json({ response: { header: { resultCode: "00" }, body: { items: { item: [
  { category: "T1H", fcstDate: "20261112", fcstTime: "1500", fcstValue: t }, { category: "SKY", fcstDate: "20261112", fcstTime: "1500", fcstValue: sky }, { category: "PTY", fcstDate: "20261112", fcstTime: "1500", fcstValue: pty },
] } } } });
const input = (extra = {}) => ({ date, entry: { id: entryId, text: "산책" }, ...extra });

beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("APP_URL", origin); vi.stubEnv("KMA_SERVICE_KEY", "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  saved = { id: entryId, content: "산책", created_at: "2026-11-12T01:00:00Z", weather_code: null, temp_c: null };
  setError = null;
  mocks.configured.mockReturnValue(true);
  mocks.userClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: alice } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: alice, onboarded: true, deleting_at: null }, error: null }) }) }) }),
    rpc,
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("fragment weather through the entry API", () => {
  test("a fragment saved with a location gets the weather; coordinates are not passed to the database", async () => {
    fetchMock.mockResolvedValue(forecast("7.4", "1", "1"));
    const r = await post(input({ lat: 35.1796, lon: 129.0756 }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ entry: { id: entryId, text: "산책", at: "2026-11-12T01:00:00Z", weather: { weather: "rain", tempC: 7.4 } } });
    expect(rpc.mock.calls).toEqual([
      ["save_team_entry", { p_id: entryId, p_content: "산책", p_date: date }],
      ["set_entry_weather", { p_id: entryId, p_code: "rain", p_temp: 7.4 }],
    ]);
  });

  test("no location, a location outside Korea, or the feature being off saves without any lookup", async () => {
    for (const extra of [{}, { lat: 48.85, lon: 2.35 }, { lat: "35.1", lon: "129.1" }]) {
      expect(await (await post(input(extra))).json()).toMatchObject({ entry: { weather: null } });
    }
    vi.stubEnv("KMA_SERVICE_KEY", "");
    expect(await (await post(input({ lat: 35.1, lon: 129.1 }))).json()).toMatchObject({ entry: { weather: null } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(([name]) => name === "save_team_entry")).toBe(true);
  });

  test("a failed lookup or a failed weather write still saves the fragment", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const failedLookup = await post(input({ lat: 37.2, lon: 127.3 }));
    expect(failedLookup.status).toBe(200);
    expect(await failedLookup.json()).toMatchObject({ entry: { text: "산책", weather: null } });
    fetchMock.mockResolvedValue(forecast("20", "3", "0"));
    setError = { message: "function public.set_entry_weather does not exist" };
    const failedWrite = await post(input({ lat: 36.4, lon: 128.1 }));
    expect(failedWrite.status).toBe(200);
    expect(await failedWrite.json()).toMatchObject({ entry: { weather: null } });
  });

  test("a retried save keeps the weather already stored and does not look it up again", async () => {
    saved = { ...saved, weather_code: "snow", temp_c: "-2.0" };
    expect(await (await post(input({ lat: 37.9, lon: 127.7 }))).json()).toMatchObject({ entry: { weather: { weather: "snow", tempC: -2 } } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("weather columns are read only while the feature is on", () => {
    expect(entryColumns()).toContain("weather_code");
    vi.stubEnv("KMA_SERVICE_KEY", "");
    expect(entryColumns()).toBe("id,content,created_at,entry_date");
    expect(entryView({ id: "a", created_at: "t", content: "c" })).toEqual({ id: "a", at: "t", text: "c", weather: null });
  });
});
