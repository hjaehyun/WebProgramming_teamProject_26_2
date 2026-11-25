// A picture in the frame its owner chose. Frames are drawn with CSS only; the image is unchanged.
// "basic" keeps each screen's own wrapper (basicClassName), so it looks exactly as before frames.
// weathers: the day's weather words for the 그림일기 frame, or null to leave the weather out
// (public and exhibition views never show it).

import { WEATHER } from "./Weather";
import { longDate } from "@/lib/date";
import { diaryCells, frameOf } from "@/lib/frames";
import s from "./Framed.module.css";

export default function Framed({ frame, date, summary = "", weathers = null, size = "lg", basicClassName, children }) {
  const id = frameOf(frame);
  if (id === "basic") return basicClassName ? <div className={basicClassName}>{children}</div> : children;
  const labels = (weathers ?? []).map((w) => WEATHER[w]).filter(Boolean);
  return (
    <div className={`${s.frame} ${s[id]} ${s[size]}`}>
      {id === "diary" && (
        <div className={s.top}>
          <span>{longDate(date)}</span>
          {weathers && (
            <span>
              날씨{" "}
              {labels.length > 0 && (
                <span role="img" aria-label={labels.map((w) => w.label).join(", ")}>
                  {labels.map((w) => w.icon).join(" ")}
                </span>
              )}
            </span>
          )}
        </div>
      )}
      <div className={s.mat}>{children}</div>
      {id === "polaroid" && <div className={s.cap}>{longDate(date)}</div>}
      {id === "diary" && (
        <div className={s.grid} aria-hidden="true">
          {diaryCells(summary).map((c, i) => (
            <i key={i}>{c}</i>
          ))}
        </div>
      )}
    </div>
  );
}
