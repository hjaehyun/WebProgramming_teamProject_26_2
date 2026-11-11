// Social login rules (specs/haru-social-login.spl). Pure, so node --test runs it.

export const PROVIDERS = ["kakao", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type AccountInfo = { kind: "email" | "social"; provider: "email" | Provider };

type Identity = { provider: string };

export function isProvider(p: string): p is Provider {
  return (PROVIDERS as readonly string[]).includes(p);
}

/**
 * Where to go after the OAuth callback: only a path on this site, otherwise /today.
 * Rejects scheme URLs, protocol-relative "//x", "/\x" (browsers read "\" as "/"), control characters
 * and encoded slashes, then double-checks that the path resolves to this origin.
 */
export function safeNext(next: string | null | undefined): string {
  const fallback = "/today";
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next) || /%(2f|5c)/i.test(next)) return fallback;
  const base = "http://same.invalid";
  try {
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}

/** Email account if it has a password login; social if it only has kakao/google. Unknown -> email (keeps the password check). */
export function accountInfo(identities: Identity[] | undefined): AccountInfo {
  const list = identities ?? [];
  if (list.length === 0 || list.some((i) => i.provider === "email")) return { kind: "email", provider: "email" };
  const social = list.find((i) => isProvider(i.provider));
  return social ? { kind: "social", provider: social.provider as Provider } : { kind: "email", provider: "email" };
}

/**
 * Supabase links a social login to an existing email account with the same address, and that can't be
 * turned off. With email confirmation off, someone could sign up first with another person's address, so
 * an account that has both a password login and a social login is refused at the callback.
 */
export function isLinkConflict(identities: Identity[] | undefined): boolean {
  const list = identities ?? [];
  return list.some((i) => i.provider === "email") && list.some((i) => i.provider !== "email");
}

/** Short-lived cookie holding the checked `next` path between the OAuth start and the callback. */
export const NEXT_COOKIE = "haru_oauth_next";
