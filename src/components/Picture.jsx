"use client";

// A day's picture: the drawn image when there is one, otherwise (no image AI, a failed drawing, or a
// signed URL that expired after an hour) the scene's example illustration. Same box as Art (.art).

import { useState } from "react";
import Art from "./Art";

export default function Picture({ scene, imageUrl, alt, imageError = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  if (imageError || (imageUrl && failedUrl === imageUrl)) return <span className="loading" role="status">그림을 불러오지 못했어요. 화면을 새로고침해 주세요.</span>;
  if (!imageUrl) return <Art scene={scene} />;
  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs; next/image would need a remote pattern and re-host them
  return <img className="art art-img" src={imageUrl} alt={alt ?? ""} loading="lazy" onError={() => setFailedUrl(imageUrl)} />;
}
