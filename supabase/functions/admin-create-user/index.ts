// supabase/functions/admin-create-user/index.ts
//
// Deploy with the Supabase CLI: `supabase functions deploy admin-create-user`
// (or paste this into Supabase Dashboard -> Edge Functions -> New Function).
//
// The SUPABASE_SERVICE_ROLE_KEY is read from an environment secret that
// Supabase sets automatically for every Edge Function — you do NOT need to
// paste it anywhere yourself, and it is never exposed to the browser.
//
// This function:
//   1. Reads the caller's own JWT (sent automatically by supabase-js)
//   2. Confirms the caller is an admin (profiles.is_admin = true)
//   3. Only then uses the service-role client to create the new user

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    // Client scoped to the CALLER's identity, to verify who is asking.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: cors });
    }

    const { data: profile } = await callerClient.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: "Only an administrator can create users" }), { status: 403, headers: cors });
    }

    const { email, password, full_name } = await req.json();
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400, headers: cors });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), { status: 400, headers: cors });
    }

    // Elevated client — service role key never leaves this server-side function.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: full_name || "" },
    });
    if (createErr) {
      return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers: cors });
    }

    return new Response(JSON.stringify({ id: created.user?.id }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
