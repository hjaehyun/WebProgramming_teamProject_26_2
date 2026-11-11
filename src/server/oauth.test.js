import { test } from "node:test";
import assert from "node:assert/strict";
import { accountInfo, isLinkConflict, isProvider, safeNext } from "./oauth.js";

test("isProvider allows only kakao and google", () => {
  assert.equal(isProvider("kakao"), true);
  assert.equal(isProvider("google"), true);
  for (const p of ["github", "abc", "", "KAKAO", "email", "__proto__"]) assert.equal(isProvider(p), false, p);
});

test("safeNext keeps same-site paths", () => {
  assert.equal(safeNext("/gallery"), "/gallery");
  assert.equal(safeNext("/gallery/2026-11-08?x=1"), "/gallery/2026-11-08?x=1");
});

test("safeNext sends everything else to /today", () => {
  const bad = [
    null,
    undefined,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "gallery",
    "/\tevil",
    "/gal\nlery",
    "/%2F%2Fevil.example",
  ];
  for (const n of bad) assert.equal(safeNext(n), "/today", String(n));
});

const id = (provider) => ({ provider });

test("accountInfo: email identity means an email account", () => {
  assert.deepEqual(accountInfo([id("email")]), { kind: "email", provider: "email" });
});

test("accountInfo: only a social identity means a social account", () => {
  assert.deepEqual(accountInfo([id("kakao")]), { kind: "social", provider: "kakao" });
  assert.deepEqual(accountInfo([id("google")]), { kind: "social", provider: "google" });
});

test("accountInfo: no identities falls back to email (password check stays)", () => {
  assert.deepEqual(accountInfo(undefined), { kind: "email", provider: "email" });
  assert.deepEqual(accountInfo([]), { kind: "email", provider: "email" });
});

test("isLinkConflict: email + social on one account is refused", () => {
  assert.equal(isLinkConflict([id("email"), id("google")]), true);
  assert.equal(isLinkConflict([id("kakao"), id("email")]), true);
});

test("isLinkConflict: a single kind of login is fine", () => {
  assert.equal(isLinkConflict([id("email")]), false);
  assert.equal(isLinkConflict([id("google")]), false);
  assert.equal(isLinkConflict([id("kakao"), id("google")]), false);
  assert.equal(isLinkConflict(undefined), false);
});
