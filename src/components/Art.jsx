// Example illustrations (public/scenes/*.webp, 768px) standing in when a day has no drawn image:
// guide, style samples, curator, and Picture's fallback.
const LABELS = {
  day: "햇볕 아래 고양이와 비 오는 창가 책상",
  cat: "햇볕 아래 누운 갈색 고양이",
  rain: "비 내리는 창가",
  park: "공원의 나무",
  cafe: "따뜻한 커피 한 잔",
  night: "달 뜬 밤의 동네",
};

export function sceneSrc(scene) {
  return `/scenes/${scene}.webp`;
}

export default function Art({ scene, className }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static files; same box (.art) as drawn pictures
    <img
      className={className ? `art art-img ${className}` : "art art-img"}
      src={sceneSrc(scene)}
      alt={LABELS[scene]}
      loading="lazy"
      decoding="async"
    />
  );
}
