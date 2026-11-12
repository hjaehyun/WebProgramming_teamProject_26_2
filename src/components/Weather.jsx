// Weather at the moment a fragment was written: an icon and the temperature in °C, on its own line
// under the fragment's time. Renders nothing when the fragment has no weather (location refused,
// lookup failed, or written before the feature existed).

const WEATHER = {
  clear: { icon: "☀️", label: "맑음" },
  cloudy: { icon: "⛅", label: "구름많음" },
  overcast: { icon: "☁️", label: "흐림" },
  rain: { icon: "🌧️", label: "비" },
  rain_snow: { icon: "🌨️", label: "비 또는 눈" },
  snow: { icon: "❄️", label: "눈" },
  shower: { icon: "🌦️", label: "소나기" },
};

/** @param {{ weather: import("@/lib/types").EntryWeather|null|undefined, at: string }} props */
export default function Weather({ weather, at }) {
  const w = weather && WEATHER[weather.weather];
  if (!w) return null;
  const hour = new Date(at).getHours();
  const icon = weather.weather === "clear" && (hour < 6 || hour >= 19) ? "🌙" : w.icon;
  const temp = Math.round(weather.tempC);
  return (
    <span role="img" aria-label={`${w.label}, 섭씨 ${temp}도`} style={{ display: "block", textAlign: "right", whiteSpace: "nowrap" }}>
      {icon} {temp}°
    </span>
  );
}
