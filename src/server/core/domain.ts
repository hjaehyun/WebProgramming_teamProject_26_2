import { z } from "zod";

export const styles = {
  watercolor: { label: "따뜻한 수채화", prompt: "Warm watercolor on textured ivory paper, soft earthy colors, gentle brush strokes" },
  pencil: { label: "색연필 드로잉", prompt: "Colored pencil on cream paper, tactile grain, gentle hand-drawn lines, warm muted colors" },
  gouache: { label: "포근한 과슈", prompt: "Cozy gouache illustration, matte flat shapes, warm limited palette, paper texture" },
  crayon: { label: "크레파스", prompt: "Warm wax crayon drawing, tactile thick strokes and soft paper texture" },
  story: { label: "동화책", prompt: "Cozy storybook illustration, gentle shapes, warm light, soft painterly texture" }
} as const;
export type Style = keyof typeof styles;
export const entrySchema = z.object({ content: z.string().trim().min(1, "한 글자 이상 남겨 주세요.").max(500, "조각글은 500자까지 쓸 수 있어요.") });
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}, "날짜를 확인해 주세요.");
export function seoulDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function displayDate(date: string) {
  const d = new Date(date + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()]}요일`;
}
export function seoulTime(value: string) {
  const d = new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000);
  const hour = d.getUTCHours();
  return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export type Entry = { id: string; content: string; created_at: string; entry_date: string };
export type Artwork = { id: string; artwork_date: string; status: "queued" | "processing" | "ready" | "failed"; title: string | null; scene_summary: string | null; image_path: string | null; error_message: string | null; attempts: number; image_url?: string | null };
export type Profile = { nickname: string; art_style: Style; ai_consent_at: string | null };
export type Dashboard = { today: string; entries: Entry[]; artworks: Artwork[]; profile: Profile; email: string; configuredAI: boolean };
