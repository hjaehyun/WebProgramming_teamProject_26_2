// GET /api/auth/callback?code=... -> session cookies, then 302 to /profile (new) or next|/today.
// Failures go to /?error=oauth; an email account that got a social login linked goes to /?error=linked.

import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/server/auth";
import { NEXT_COOKIE, isLinkConflict, safeNext } from "@/server/oauth";
import { supabaseForRequest } from "@/server/supabase";

export async function GET(req) {
  const origin = req.nextUrl.origin;
  const go = (path) => {
    const res = NextResponse.redirect(new URL(path, origin));
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    res.cookies.delete({ name: NEXT_COOKIE, path: "/api/auth/callback" });
    return res;
  };

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    // The provider's error text is never shown to the user.
    if (req.nextUrl.searchParams.get("error")) console.warn("[oauth] provider returned an error");
    return go("/?error=oauth");
  }

  try {
    const sb = await supabaseForRequest();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const { data } = await sb.auth.getUser();
    const user = data.user;
    if (!user) throw new Error("no user after exchange");

    // Same-address auto-linking can't be turned off in Supabase; refuse it here (pre-account takeover).
    if (isLinkConflict(user.identities)) {
      await sb.auth.signOut({ scope: "local" });
      await clearAuthCookies();
      return go("/?error=linked");
    }

    const prof = await sb.from("profiles").select("id,onboarded").eq("id", user.id).maybeSingle();
    if (prof.error) throw prof.error;
    if (!prof.data?.onboarded) return go("/profile");
    return go(safeNext(req.cookies.get(NEXT_COOKIE)?.value));
  } catch {
    console.warn("[oauth] callback failed");
    await clearAuthCookies().catch(() => {});
    return go("/?error=oauth");
  }
}
