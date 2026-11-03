import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });

  try {
    const { username: rawUsername, password } = await request.json();
    const username = String(rawUsername ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || typeof password !== "string" || !password) {
      return reply(400, { error: "Invalid username or password" });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const anonKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      console.error("Required Supabase function secrets are missing");
      return reply(500, { error: "Sign-in service is not configured" });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: profile, error: profileError } = await admin
      .from("staff_profiles").select("user_id, active").eq("username", username).maybeSingle();
    if (profileError || !profile?.active) return reply(401, { error: "Invalid username or password" });

    const { data: membership, error: membershipError } = await admin
      .from("staff_memberships").select("active").eq("user_id", profile.user_id).maybeSingle();
    if (membershipError || !membership?.active) return reply(401, { error: "Invalid username or password" });

    const { data, error } = await auth.auth.signInWithPassword({
      email: `${username}@staff.kbms.invalid`,
      password,
    });
    if (error || !data.session) return reply(401, { error: "Invalid username or password" });

    return reply(200, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
      user: { id: data.user.id },
    });
  } catch (error) {
    console.error("Username login failed", error);
    return reply(400, { error: "Invalid username or password" });
  }
});
