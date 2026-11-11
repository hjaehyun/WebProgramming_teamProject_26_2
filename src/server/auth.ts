// Sign-in helpers on top of Supabase Auth. The session is kept in sb-* cookies by @supabase/ssr.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseForRequest, supabaseStateless } from "./supabase";

/** The signed-in user and a client acting as them, or null. Every /api/me route starts here. */
export async function requireUser(): Promise<{ sb: SupabaseClient; user: User } | null> {
  const sb = await supabaseForRequest();
  // getUser() asks the Auth server, so a forged or revoked cookie is rejected.
  const { data } = await sb.auth.getUser();
  return data.user ? { sb, user: data.user } : null;
}

/** Re-checks a password (before changing it or deleting the account) without disturbing this browser's session. */
export async function checkPassword(email: string, password: string): Promise<boolean> {
  const c = supabaseStateless();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) return false;
  await c.auth.signOut({ scope: "local" }); // drop the throwaway session
  return true;
}

/** Removes the auth cookies directly, for when the server-side session is already gone. */
export async function clearAuthCookies(): Promise<void> {
  const jar = await cookies();
  for (const c of jar.getAll()) if (c.name.startsWith("sb-")) jar.delete(c.name);
}
