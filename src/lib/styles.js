// The four drawing styles. `particle` is the Korean particle after the label, so labels read
// naturally (수채화로, 동화책으로). `sample` is the example scene shown on the style picker.
export const STYLES = [
  { id: "water", label: "수채화", particle: "로", desc: "번지는 따뜻한 색", sample: "day" },
  { id: "pencil", label: "색연필", particle: "로", desc: "사각사각 선", sample: "park" },
  { id: "crayon", label: "크레파스", particle: "로", desc: "꾹꾹 눌러 칠한", sample: "cafe" },
  { id: "story", label: "동화책", particle: "으로", desc: "포근한 밤 장면", sample: "night" },
];

export function styleOf(id) {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

/** "수채화로" */
export function withParticle(id) {
  const s = styleOf(id);
  return s.label + s.particle;
}
