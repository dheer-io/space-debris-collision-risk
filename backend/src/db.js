import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// The secret key bypasses row-level security, which is fine here — this
// process is the only thing that talks to Supabase, there's no end-user
// session to scope access to.
export const supabase = createClient(env.supabaseUrl, env.supabaseSecretKey, {
  auth: { persistSession: false },
});
