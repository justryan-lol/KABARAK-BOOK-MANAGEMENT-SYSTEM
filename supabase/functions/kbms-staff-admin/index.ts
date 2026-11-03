import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const roles = new Set([
  "admin", "librarian", "read_only", "super_admin", "library_admin",
  "library_assistant", "bookstore_admin", "bookstore_assistant", "auditor",
  "principal", "deputy_principal", "teacher", "class_teacher", "subject_teacher",
]);

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });

  let createdUserId: string | null = null;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const anonKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return reply(500, { error: "Staff service is not configured" });

    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return reply(401, { error: "Sign-in is required" });

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return reply(401, { error: "Your session is invalid or expired" });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const actorId = userData.user.id;
    const { data: actorMembership, error: actorError } = await admin
      .from("staff_memberships").select("role, active").eq("user_id", actorId).maybeSingle();
    if (actorError || !actorMembership?.active || !["admin", "super_admin"].includes(actorMembership.role)) {
      return reply(403, { error: "Only an active administrator can manage staff accounts" });
    }
    const isSuper = actorMembership.role === "super_admin";
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "provision") {
      const displayName = String(body.display_name || "").trim();
      const username = String(body.username || "").trim().toLowerCase();
      const staffNumber = String(body.staff_number || "").trim();
      const department = String(body.department || "").trim();
      const role = String(body.role || "");
      if (displayName.length < 2 || displayName.length > 120) return reply(400, { error: "Enter a valid staff name" });
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) return reply(400, { error: "Username must be 3–32 letters, numbers, dots, underscores or hyphens" });
      if (staffNumber.length > 40 || department.length > 80 || !roles.has(role)) return reply(400, { error: "Invalid staff details or role" });
      if (role === "super_admin" && !isSuper) return reply(403, { error: "Only a super administrator can appoint another super administrator" });

      const { data: existing, error: lookupError } = await admin.from("staff_profiles")
        .select("user_id").eq("username", username).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) return reply(409, { error: "That username is already in use" });
      if (staffNumber) {
        const { data: numberMatch, error: numberError } = await admin.from("staff_profiles")
          .select("user_id").eq("staff_number", staffNumber).maybeSingle();
        if (numberError) throw numberError;
        if (numberMatch) return reply(409, { error: "That staff number is already in use" });
      }

      const password = temporaryPassword();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: `${username}@staff.kbms.invalid`,
        password,
        email_confirm: true,
        user_metadata: { must_change_password: true, kbms_username: username },
      });
      if (createError || !created.user) throw createError || new Error("Could not create Auth user");
      createdUserId = created.user.id;

      const { error: profileError } = await admin.from("staff_profiles").insert({
        user_id: createdUserId, display_name: displayName, username,
        staff_number: staffNumber || null, department, active: true,
      });
      if (profileError) throw profileError;

      const { error: roleError } = await userClient.rpc("admin_set_staff_membership", {
        p_user_id: createdUserId, p_role: role, p_active: true,
      });
      if (roleError) throw roleError;

      return reply(200, { username, temporary_password: password });
    }

    if (!["reset_password", "activate", "deactivate", "change_role"].includes(action)) {
      return reply(400, { error: "Unsupported staff action" });
    }
    const userId = String(body.user_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || userId === actorId) {
      return reply(400, { error: "Invalid target staff account" });
    }
    const { data: target, error: targetError } = await admin.from("staff_profiles")
      .select("user_id, username").eq("user_id", userId).maybeSingle();
    if (targetError || !target) return reply(404, { error: "Staff account not found" });
    const { data: targetMembership, error: targetRoleError } = await admin.from("staff_memberships")
      .select("role, active").eq("user_id", userId).maybeSingle();
    if (targetRoleError || !targetMembership) return reply(404, { error: "Staff membership not found" });
    if (targetMembership.role === "super_admin" && !isSuper) return reply(403, { error: "Only a super administrator can manage another super administrator" });

    if (action === "reset_password") {
      const password = temporaryPassword();
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password, user_metadata: { ...((await admin.auth.admin.getUserById(userId)).data.user?.user_metadata || {}), must_change_password: true },
      });
      if (error) throw error;
      return reply(200, { username: target.username, temporary_password: password });
    }

    const nextRole = action === "change_role" ? String(body.role || "") : targetMembership.role;
    if (!roles.has(nextRole)) return reply(400, { error: "Unknown staff role" });
    if (nextRole === "super_admin" && !isSuper) return reply(403, { error: "Only a super administrator can appoint another super administrator" });
    const active = action === "deactivate" ? false : action === "activate" ? true : targetMembership.active;
    const { error: updateError } = await userClient.rpc("admin_set_staff_membership", {
      p_user_id: userId, p_role: nextRole, p_active: active,
    });
    if (updateError) throw updateError;
    return reply(200, { success: true, username: target.username, role: nextRole, active });
  } catch (error) {
    if (createdUserId) {
      try {
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (url && key) {
          const cleanup = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
          await cleanup.from("staff_profiles").delete().eq("user_id", createdUserId);
          await cleanup.auth.admin.deleteUser(createdUserId);
        }
      } catch (cleanupError) { console.error("Failed to roll back incomplete staff account", cleanupError); }
    }
    console.error("Staff administration failed", error);
    return reply(500, { error: error instanceof Error ? error.message : "Staff action failed" });
  }
});
