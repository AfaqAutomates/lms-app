// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface CreateUserPayload {
  email: string;
  password: string;
  full_name?: string;
}

console.info("admin-create-user started");

// auth: "user" — only a signed-in caller (supabase-js sends their session
// JWT automatically) may call this. We then check profiles.is_admin
// ourselves before doing anything privileged.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    // ctx.supabase is scoped to the CALLER's own identity/RLS — safe to
    // use for checking who they are.
    const callerId = ctx.userClaims?.sub;
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", callerId)
      .maybeSingle();

    if (!profile?.is_admin) {
      return Response.json({ error: "Only an administrator can create users" }, { status: 403 });
    }

    let body: CreateUserPayload;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { email, password, full_name } = body;
    if (!email || !password) {
      return Response.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    // ctx.supabaseAdmin bypasses RLS using the function's own secret key —
    // this key is never sent to or stored in the browser.
    const { data: created, error } = await ctx.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || "" },
    });
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ id: created.user?.id });
  }),
};
