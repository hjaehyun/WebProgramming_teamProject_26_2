import assert from "node:assert/strict";
import { test } from "node:test";
import { STYLES, styleOf, withParticle } from "./styles.js";

test("the anime style comes fifth and reads naturally", () => {
  assert.deepEqual(STYLES.map((s) => s.id), ["water", "pencil", "crayon", "story", "anime"]);
  assert.equal(styleOf("anime").label, "애니 풍경");
  assert.equal(withParticle("anime"), "애니 풍경으로");
  assert.equal(withParticle("water"), "수채화로");
});

test("old gouache pictures still have a label", () => {
  assert.equal(withParticle("gouache"), "과슈로");
});
