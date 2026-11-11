// Client call for the public exhibition viewer (/e/[id]).

import type { PublicExhibition } from "./types";

/** The exhibition, null when it's private or missing (404); throws with a showable message otherwise. */
export async function fetchPublicExhibition(id: string): Promise<PublicExhibition | null> {
  const res = await fetch(`/api/exhibitions/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `불러오지 못했어요 (${res.status})`);
  return data as PublicExhibition;
}
