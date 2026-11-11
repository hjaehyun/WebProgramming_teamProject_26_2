import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { baseTime, lookupWeather, readCoords, toGrid, toWeather, weatherEnabled } from "../src/server/weather";

const fetchMock = vi.fn<typeof fetch>();
const item = (category: string, fcstTime: string, fcstValue: string, fcstDate = "20261112") => ({ category, fcstDate, fcstTime, fcstValue });
const kma = (items: unknown[], resultCode = "00") => Response.json({ response: { header: { resultCode }, body: { items: { item: items } } } });
const seoul = { lat: 37.57, lon: 126.98 };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("KMA_SERVICE_KEY", " plain+key/with=chars ");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("weather lookup", () => {
  test("is off without a server key and then never calls KMA", async () => {
    vi.stubEnv("KMA_SERVICE_KEY", "  ");
    expect(weatherEnabled()).toBe(false);
    expect(await lookupWeather(seoul)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("accepts only numeric coordinates inside Korea and rounds them to about 1 km", () => {
    expect(readCoords({ lat: 37.566535, lon: 126.977969, date: "x" })).toEqual({ lat: 37.57, lon: 126.98 });
    for (const bad of [null, {}, { lat: "37.5", lon: 127 }, { lat: 37.5 }, { lat: 48.85, lon: 2.35 }, { lat: NaN, lon: 127 }]) expect(readCoords(bad)).toBeNull();
  });

  test("converts coordinates to the published KMA grid cells", () => {
    expect(toGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 }); // Seoul
    expect(toGrid(35.1796, 129.0756)).toEqual({ nx: 98, ny: 76 }); // Busan
    expect(toGrid(33.4996, 126.5312)).toEqual({ nx: 53, ny: 38 }); // Jeju
  });

  test("uses the latest forecast that is already being served (KST)", () => {
    expect(baseTime(new Date("2026-11-12T05:50:00Z"))).toEqual({ base_date: "20261112", base_time: "1430" });
    expect(baseTime(new Date("2026-11-12T05:44:00Z"))).toEqual({ base_date: "20261112", base_time: "1330" });
    expect(baseTime(new Date("2026-11-11T15:10:00Z"))).toEqual({ base_date: "20261111", base_time: "2330" }); // 00:10 KST
  });

  test("maps the nearest forecast hour; precipitation wins over sky cover", () => {
    const base = [item("T1H", "1600", "9"), item("T1H", "1500", "11.26"), item("SKY", "1500", "3"), item("PTY", "1500", "0")];
    expect(toWeather(base)).toEqual({ weather: "cloudy", tempC: 11.3 });
    expect(toWeather([...base.slice(0, 3), item("PTY", "1500", "1")])).toEqual({ weather: "rain", tempC: 11.3 });
    expect(toWeather([item("T1H", "0000", "-3", "20261113"), item("T1H", "2300", "-1"), item("SKY", "2300", "1"), item("PTY", "2300", "7")])).toEqual({ weather: "snow", tempC: -1 });
    expect(toWeather([item("SKY", "1500", "1"), item("PTY", "1500", "0")])).toBeNull(); // no temperature
    expect(toWeather([item("T1H", "1500", "-999"), item("SKY", "1500", "1")])).toBeNull(); // KMA missing-value marker
    expect(toWeather([item("T1H", "1500", "10"), item("SKY", "1500", "9")])).toBeNull();
  });

  test("sends only the grid cell, and shares one call per cell and forecast", async () => {
    fetchMock.mockImplementation(async () => kma([item("T1H", "1500", "18"), item("SKY", "1500", "1"), item("PTY", "1500", "0")]));
    const now = new Date("2026-11-12T05:50:00Z");
    expect(await lookupWeather(seoul, now)).toEqual({ weather: "clear", tempC: 18 });
    expect(await lookupWeather({ lat: 37.56, lon: 126.97 }, now)).toEqual({ weather: "clear", tempC: 18 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst");
    expect(Object.fromEntries(url.searchParams)).toEqual({ serviceKey: "plain+key/with=chars", pageNo: "1", numOfRows: "60", dataType: "JSON", base_date: "20261112", base_time: "1430", nx: "60", ny: "127" });
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/37\.5|126\.9/);
  });

  test("an already encoded key is not encoded twice", async () => {
    vi.stubEnv("KMA_SERVICE_KEY", "abc%2Bdef%3D");
    fetchMock.mockResolvedValue(kma([]));
    await lookupWeather({ lat: 35.18, lon: 129.08 }, new Date("2026-11-12T01:50:00Z"));
    expect(String(fetchMock.mock.calls[0][0])).toContain("serviceKey=abc%2Bdef%3D&");
  });

  test("provider errors, bad bodies and timeouts mean no weather, are not cached, and log no location", async () => {
    const now = new Date("2026-11-12T08:50:00Z"), jeju = { lat: 33.5, lon: 126.53 };
    fetchMock.mockResolvedValueOnce(kma([], "30"));
    expect(await lookupWeather(jeju, now)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("<OpenAPI_ServiceResponse/>", { status: 200 }));
    expect(await lookupWeather(jeju, now)).toBeNull();
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    expect(await lookupWeather(jeju, now)).toBeNull();
    fetchMock.mockResolvedValueOnce(kma([item("T1H", "1800", "14"), item("SKY", "1800", "4"), item("PTY", "1800", "0")]));
    expect(await lookupWeather(jeju, now)).toEqual({ weather: "overcast", tempC: 14 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/33\.5|126\.53|plain/);
  });
});
