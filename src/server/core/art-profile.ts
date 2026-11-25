import "server-only";
import { z } from "zod";

const singleLine = (max: number) => z.string().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).transform(value => value.trim());

// Kept strict at both the profile API and the saved-job boundary. Account fields
// and arbitrary profile metadata must never be forwarded to the drawing model.
export const artProfileSchema = z.object({
  gender: z.enum(["unspecified", "female", "male", "neutral"]).default("unspecified"),
  ageRange: z.enum(["unspecified", "child", "teen", "20s", "30s", "40s", "50s", "60plus"]).default("unspecified"),
  occupation: singleLine(80).default(""),
  appearance: singleLine(200).default(""),
}).strict();

export type ArtProfile = z.infer<typeof artProfileSchema>;

/** Legacy profiles have no extra fields. Invalid persisted context is not displayed as trusted input. */
export function artProfileView(value: unknown): ArtProfile {
  const parsed = artProfileSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : artProfileSchema.parse({});
}

/** Send only provided visual context, omitting unspecified attributes and empty strings. */
export function artProfileContext(value: unknown = {}): Partial<ArtProfile> {
  const parsed = artProfileSchema.safeParse(value);
  if (!parsed.success) throw new Error("그림에 반영할 프로필 정보를 확인하지 못했어요.");
  const profile = parsed.data;
  return {
    ...(profile.gender !== "unspecified" ? { gender: profile.gender } : {}),
    ...(profile.ageRange !== "unspecified" ? { ageRange: profile.ageRange } : {}),
    ...(profile.occupation ? { occupation: profile.occupation } : {}),
    ...(profile.appearance ? { appearance: profile.appearance } : {}),
  };
}
