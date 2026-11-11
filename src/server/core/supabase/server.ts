import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function configured() {
  return Boolean(supabaseUrl() && publishableKey());
}
export function supabaseUrl() { return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)?.trim(); }
export function publishableKey() { return (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY)?.trim(); }
export const authCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
export function statelessClient() {
  return createClient(supabaseUrl()!, publishableKey()!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export async function userClient() {
  const jar = await cookies();
  return createServerClient(supabaseUrl()!, publishableKey()!, {
    cookieOptions: authCookieOptions,
    cookies: { getAll: () => jar.getAll(), setAll: (items) => {
      try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Proxy refreshes cookies for Server Components. */ }
    } }
  });
}
export function adminClient() {
  const serverKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serverKey) throw new Error("서버 DB 연결 설정이 필요해요.");
  return createClient(supabaseUrl()!, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
