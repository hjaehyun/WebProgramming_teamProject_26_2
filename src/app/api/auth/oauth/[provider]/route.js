// GET /api/auth/oauth/kakao|google[?next=/path] -> 302 to the provider's login page (specs/haru-social-login.spl)
// PKCE: @supabase/ssr keeps the code verifier in an HttpOnly cookie; the callback exchanges the code.
// Provider keys live only in the Supabase dashboard.

import { NextResponse } from "next/server";
import { NEXT_COOKIE, isProvider, safeNext } from "@/server/oauth";
import { supabaseForRequest } from "@/server/supabase";

export async function GET(req, ctx) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return NextResponse.json({ error: "지원하지 않는 로그인 방식이에요" }, { status: 400 });

  const origin = req.nextUrl.origin;
  try {
    const sb = await supabaseForRequest();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin}/api/auth/callback`, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw error ?? new Error("no provider url");

    const res = NextResponse.redirect(data.url);
    // Where to land afterwards, kept in our own short cookie (not in redirectTo, which must match the allow list).
    res.cookies.set(NEXT_COOKIE, safeNext(req.nextUrl.searchParams.get("next")), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/callback",
      maxAge: 600,
    });
    return res;
  } catch {
    console.warn("[oauth] start failed");
    return NextResponse.redirect(new URL("/?error=oauth", origin));
  }
}
