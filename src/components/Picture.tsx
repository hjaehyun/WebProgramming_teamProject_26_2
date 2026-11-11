"use client";

// A day's picture: the drawn image when there is one, otherwise (no image AI, a failed drawing, or a
// signed URL that expired after an hour) the scene's example illustration. Same box as Art (.art).

import { useEffect, useState } from "react";
import type { Scene } from "@/lib/types";
import Art from "./Art";

export default function Picture({ scene, imageUrl, alt }: { scene: Scene; imageUrl?: string | null; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  if (!imageUrl || failed) return <Art scene={scene} />;
  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs; next/image would need a remote pattern and re-host them
  return <img className="art art-img" src={imageUrl} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} />;
}
