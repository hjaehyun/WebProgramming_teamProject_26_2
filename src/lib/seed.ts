import { addDays, fromKey, todayKey } from "./date";
import type { Artwork, DB, Entry, Scene } from "./types";

// Sample past days so the gallery, curator and exhibition have something to show.
const SAMPLES: { scene: Scene; tags: string[]; summary: string; texts: string[] }[] = [
  {
    scene: "cat",
    tags: ["동물"],
    summary: "햇살 아래 늘어진 갈색 고양이와 따뜻한 오후.",
    texts: ["길 가다 갈색 고양이를 봤는데 햇볕 밑에 잘 누워 있더라. 팔자 좋다", "오늘 날씨 좋다"],
  },
  {
    scene: "rain",
    tags: ["비", "공부"],
    summary: "비 내리는 창가 책상 위의 과제 더미.",
    texts: ["밖에 비 오네", "과제 언제 다 하지"],
  },
  {
    scene: "park",
    tags: ["산책"],
    summary: "노랗게 물든 공원 길을 천천히 걷는 저녁.",
    texts: ["단풍 진짜 예쁘다", "공원 한 바퀴 걸었다"],
  },
  {
    scene: "cafe",
    tags: ["커피", "먹을 것"],
    summary: "창가 자리의 따뜻한 라떼 한 잔.",
    texts: ["카페에서 라떼 마심", "케이크도 하나"],
  },
  {
    scene: "night",
    tags: ["밤"],
    summary: "불 켜진 창들이 보이는 달 뜬 밤의 동네.",
    texts: ["오늘 달 엄청 밝다", "잠이 안 온다"],
  },
  {
    scene: "day",
    tags: ["동물", "비", "공부"],
    summary: "오전엔 햇살 아래 고양이, 오후엔 비 내리는 창가의 과제.",
    texts: ["고양이 봤다", "교수님이 과제를 많이 내줬다", "아 배고프다", "밖에 비 오네"],
  },
];

const SKIP = new Set([3, 9, 14, 22, 29]); // days back with no picture

function atTime(date: string, h: number, m: number): string {
  const d = fromKey(date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function entriesFor(date: string, texts: string[]): Entry[] {
  return texts.map((text, i) => ({ id: `${date}-${i}`, at: atTime(date, 9 + i * 3, (i * 17) % 60), text }));
}

export function createSeed(): DB {
  const today = todayKey();
  const artworks: Record<string, Artwork> = {};
  for (let back = 1; back <= 40; back++) {
    if (SKIP.has(back)) continue;
    const date = addDays(today, -back);
    const s = SAMPLES[back % SAMPLES.length];
    artworks[date] = {
      date,
      scene: s.scene,
      style: "water",
      summary: s.summary,
      tags: s.tags,
      entries: entriesFor(date, s.texts),
    };
  }

  const drafts: Record<string, Entry[]> = {
    [today]: [
      { id: "t1", at: atTime(today, 9, 12), text: "길 가다 갈색 고양이를 봤는데 햇볕 밑에 잘 누워 있더라. 팔자 좋다" },
      { id: "t2", at: atTime(today, 13, 40), text: "교수님이 과제를 많이 내줬다. 기한 안에 다 할 수 있을까" },
      { id: "t3", at: atTime(today, 16, 5), text: "아 배고프다" },
      { id: "t4", at: atTime(today, 18, 20), text: "밖에 비 오네" },
    ],
  };

  const rainy = Object.values(artworks)
    .filter((a) => a.tags.includes("비"))
    .map((a) => a.date)
    .sort()
    .slice(0, 3);

  return {
    account: null,
    profile: null,
    drafts,
    artworks,
    exhibition: { id: "demo", title: "나의 가을 전시", desc: "비 오는 날만 모았어요", isPublic: true, dates: rainy },
  };
}
