// Supabase clients for server code. Keys come from .env.local (see .env.example) and never reach the browser.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (.env.local)`);
  return v;
}

/**
 * Auth cookie flags (M2). The browser never talks to Supabase, so no script needs to read sb-* cookies:
 * httpOnly keeps the tokens away from JS (XSS), secure keeps them off plain HTTP in production.
 */
const AUTH_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

const NO_STORAGE = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * Acts as the signed-in user: the auth session lives in cookies, so RLS sees auth.uid().
 * Use this for everything the user does with their own data.
 */
export async function supabaseForRequest() {
  const jar = await cookies();
  return createServerClient(env("SUPABASE_URL"), env("SUPABASE_PUBLISHABLE_KEY"), {
    cookieOptions: AUTH_COOKIE,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) jar.set(name, value, options);
      },
    },
  });
}

/** Throwaway client with no cookies, e.g. to check a password without touching the browser's session. */
export function supabaseStateless() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_PUBLISHABLE_KEY"), NO_STORAGE);
}

/** Bypasses RLS. Only for admin actions the user can't do themselves (deleting their account). */
export function supabaseAdmin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), NO_STORAGE);
}
