"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Art from "@/components/Art";
import { Screen } from "@/components/ui";
import { useStore } from "@/lib/store";
import { STYLES } from "@/lib/styles";
import s from "./guide.module.css";

// How-to slides shown once after the first profile setup, and again from the my page.
export default function GuidePage() {
  return (
    <Screen>
      <Guide />
    </Screen>
  );
}

const CALENDAR = [null, "cat", null, "rain", "park", null, "cafe", "night", null, "day", null, "cat", "rain", null];

function Guide() {
  const router = useRouter();
  const { db } = useStore();
  const [i, setI] = useState(0);
  const startX = useRef(null);
  const style = STYLES.find((st) => st.id === db.profile?.style) ?? STYLES[0];

  const slides = [
    {
      title: "생각날 때 한 줄씩",
      body: "잘 쓸 필요 없어요. 지금 본 것, 먹은 것, 기분 한 단어면 충분해요. AI 전송에 동의하면 조각글과 작성 시각을 OpenAI로 보내 장면을 정리하고 그림을 그려요. 이름이나 연락처 등 민감한 정보는 적지 마세요.",
      art: (
        <div className={s.chat}>
          <span className={s.time}>오전 9:12</span>
          <p className={s.bubble}>창밖에 비가 온다</p>
          <span className={s.time}>오후 1:40</span>
          <p className={s.bubble}>김치찌개 먹음</p>
          <span className={s.time}>오후 6:05</span>
          <p className={s.bubble}>고양이가 낮잠 잔다</p>
        </div>
      ),
    },
    {
      title: "마감하면 그림 한 장",
      body: `'오늘 마감하고 그림 그리기'를 누르면 그날 모은 조각들이 ${style.label} 그림 한 장이 돼요. 마감한 날에는 조각을 더할 수 없어요.`,
      art: (
        <div className={s.merge}>
          <div className={s.pieces} aria-hidden="true">
            <span>비</span>
            <span>김치찌개</span>
            <span>고양이</span>
          </div>
          <svg className={s.arrow} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
          <span className={s.frame}>
            <Art scene="day" />
          </span>
        </div>
      ),
    },
    {
      title: "달력에 차곡차곡",
      body: "갤러리 달력에 하루 한 장씩 쌓여요. 날짜를 누르면 그날 그림과 쓴 조각을 함께 볼 수 있어요.",
      art: (
        <div className={s.calendar} aria-hidden="true">
          {CALENDAR.map((scene, n) => (
            <span key={n} className={scene ? s.day : `${s.day} ${s.empty}`}>
              {scene && <Art scene={scene} />}
            </span>
          ))}
        </div>
      ),
    },
    {
      title: "골라서 전시회로",
      body: "마음에 드는 그림만 골라 나만의 전시회를 열어요. 공개로 바꾸면 링크로 친구에게 보여줄 수 있어요.",
      art: (
        <div className={s.wall} aria-hidden="true">
          {["cat", "park", "night"].map((scene) => (
            <span key={scene} className={s.hung}>
              <Art scene={scene} />
            </span>
          ))}
        </div>
      ),
    },
  ];
  const last = i === slides.length - 1;

  const go = (n) => setI(Math.max(0, Math.min(slides.length - 1, n)));
  const finish = () => router.push("/today");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") setI((n) => Math.min(slides.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  return (
    <>
      <header className={s.head}>
        <span className={s.step}>
          {i + 1} / {slides.length}
        </span>
        <button className={s.skip} onClick={finish}>
          건너뛰기
        </button>
      </header>

      <main
        className={s.viewport}
        onPointerDown={(e) => (startX.current = e.clientX)}
        onPointerUp={(e) => {
          if (startX.current === null) return;
          const dx = e.clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
        }}
      >
        <div className={s.track} style={{ transform: `translateX(-${i * 100}%)` }}>
          {slides.map((sl, n) => (
            <section key={sl.title} className={s.slide} aria-hidden={n !== i} aria-roledescription="slide" aria-label={`${n + 1} / ${slides.length}`}>
              <div className={s.art}>{sl.art}</div>
              <h1 className={`hand ${s.title}`}>{sl.title}</h1>
              <p className={s.body}>{sl.body}</p>
            </section>
          ))}
        </div>
      </main>

      <div className="bar">
        <div className={s.dots}>
          {slides.map((sl, n) => (
            <button
              key={sl.title}
              className={n === i ? `${s.dot} ${s.on}` : s.dot}
              aria-label={`${n + 1}번째 안내`}
              aria-current={n === i ? "step" : undefined}
              onClick={() => go(n)}
            />
          ))}
        </div>
        <div className={s.buttons}>
          {i > 0 && (
            <button className={`btn ghost ${s.prev}`} onClick={() => go(i - 1)}>
              이전
            </button>
          )}
          <button className="btn" onClick={last ? finish : () => go(i + 1)}>
            {last ? "첫 조각 쓰러 가기" : "다음"}
          </button>
        </div>
      </div>
    </>
  );
}
