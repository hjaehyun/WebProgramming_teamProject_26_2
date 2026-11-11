// Keep OAuth on the same cookie/client configuration as the rest of the backend.
export { userClient as supabaseForRequest, statelessClient as supabaseStateless, adminClient as supabaseAdmin } from "./core/supabase/server";
