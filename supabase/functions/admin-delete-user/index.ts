import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResp({ ok: false, error: "method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResp({ ok: false, error: "missing env vars" }, 500);
  }

  const jwt = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!jwt) return jsonResp({ ok: false, error: "missing auth" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: role, error: roleErr } =
    await userClient.rpc("current_user_role");
  if (roleErr) {
    return jsonResp(
      { ok: false, error: `role check failed: ${roleErr.message}` },
      500,
    );
  }
  if (role !== "admin") {
    return jsonResp({ ok: false, error: "admin only" }, 403);
  }

  const { data: caller } = await userClient.auth.getUser();
  const callerAuthId = caller?.user?.id || null;
  if (!callerAuthId) {
    return jsonResp({ ok: false, error: "could not resolve caller" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: "invalid json body" }, 400);
  }

  const portal_user_id =
    typeof body?.portal_user_id === "string" ? body.portal_user_id.trim() : "";
  if (!portal_user_id) {
    return jsonResp({ ok: false, error: "portal_user_id is required" }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Load target row so we know the email for the response + the auth_user_id
  // for the final auth.users delete. maybeSingle() so we 404 cleanly if the id
  // doesn't exist or was already removed.
  const { data: target, error: targetErr } = await adminClient
    .from("users")
    .select("id, auth_user_id, email, role")
    .eq("id", portal_user_id)
    .maybeSingle();
  if (targetErr) {
    return jsonResp(
      { ok: false, error: `user lookup failed: ${targetErr.message}` },
      500,
    );
  }
  if (!target) {
    return jsonResp({ ok: false, error: "user not found" }, 404);
  }

  // Refuse self-delete
  if (target.auth_user_id && target.auth_user_id === callerAuthId) {
    return jsonResp(
      { ok: false, error: "Cannot delete your own account" },
      400,
    );
  }

  // Refuse deleting the last remaining admin
  if (target.role === "admin") {
    const { count: adminCount, error: adminCountErr } = await adminClient
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (adminCountErr) {
      return jsonResp(
        { ok: false, error: `admin count failed: ${adminCountErr.message}` },
        500,
      );
    }
    if ((adminCount || 0) <= 1) {
      return jsonResp(
        { ok: false, error: "Cannot delete the last admin" },
        400,
      );
    }
  }

  const steps: {
    step: string;
    status: "ok" | "skipped" | "failed";
    detail?: string;
  }[] = [];

  // 1. Delete user_locations (N-to-N membership rows). Hard delete is safe;
  //    these carry no auditable information on their own.
  try {
    const { error } = await adminClient
      .from("user_locations")
      .delete()
      .eq("user_id", portal_user_id);
    if (error) throw error;
    steps.push({ step: "user_locations", status: "ok" });
  } catch (e: any) {
    steps.push({
      step: "user_locations",
      status: "failed",
      detail: e?.message || String(e),
    });
    console.error(`[admin-delete-user] user_locations failed:`, e);
    return jsonResp(
      {
        ok: false,
        error: `user_locations delete failed: ${e?.message || e}`,
        steps,
      },
      500,
    );
  }

  // 2. Delete call_logs. call_logs.user_id -> public.users.id (not auth.users).
  //    These are per-call audit rows; hard-delete keeps the user_id FK from
  //    blocking the public.users delete below.
  try {
    const { error } = await adminClient
      .from("call_logs")
      .delete()
      .eq("user_id", portal_user_id);
    if (error) throw error;
    steps.push({ step: "call_logs", status: "ok" });
  } catch (e: any) {
    steps.push({
      step: "call_logs",
      status: "failed",
      detail: e?.message || String(e),
    });
    console.error(`[admin-delete-user] call_logs failed:`, e);
    return jsonResp(
      {
        ok: false,
        error: `call_logs delete failed: ${e?.message || e}`,
        steps,
      },
      500,
    );
  }

  // 3. NULL out coaching_sessions.coach_user_id. Phase 10 coaching sessions
  //    are the portal's honesty mechanism — they must survive when the coach
  //    is offboarded. coach_user_id was made nullable in the migration
  //    coaching_sessions_coach_user_id_nullable.
  try {
    const { error } = await adminClient
      .from("coaching_sessions")
      .update({ coach_user_id: null })
      .eq("coach_user_id", portal_user_id);
    if (error) throw error;
    steps.push({ step: "coaching_sessions_nullified", status: "ok" });
  } catch (e: any) {
    steps.push({
      step: "coaching_sessions_nullified",
      status: "failed",
      detail: e?.message || String(e),
    });
    console.error(`[admin-delete-user] coaching_sessions update failed:`, e);
    return jsonResp(
      {
        ok: false,
        error: `coaching_sessions update failed: ${e?.message || e}`,
        steps,
      },
      500,
    );
  }

  // 4. Delete the public.users row
  try {
    const { error } = await adminClient
      .from("users")
      .delete()
      .eq("id", portal_user_id);
    if (error) throw error;
    steps.push({ step: "public_users", status: "ok" });
  } catch (e: any) {
    steps.push({
      step: "public_users",
      status: "failed",
      detail: e?.message || String(e),
    });
    console.error(`[admin-delete-user] public.users delete failed:`, e);
    return jsonResp(
      {
        ok: false,
        error: `users delete failed: ${e?.message || e}`,
        steps,
      },
      500,
    );
  }

  // 5. Delete the auth.users row so the email can be re-invited later.
  //    Portal-only users (auth_user_id null) skip this step.
  if (target.auth_user_id) {
    try {
      const { error } = await adminClient.auth.admin.deleteUser(
        target.auth_user_id,
      );
      if (error) throw error;
      steps.push({ step: "auth_users", status: "ok" });
    } catch (e: any) {
      // public.users is already gone at this point; surface the auth-delete
      // failure so the admin knows to clean up the orphan auth row manually.
      steps.push({
        step: "auth_users",
        status: "failed",
        detail: e?.message || String(e),
      });
      console.error(`[admin-delete-user] auth.users delete failed:`, e);
      return jsonResp(
        {
          ok: false,
          error: `auth user delete failed: ${e?.message || e}`,
          deleted_email: target.email,
          steps,
        },
        500,
      );
    }
  } else {
    steps.push({
      step: "auth_users",
      status: "skipped",
      detail: "no auth_user_id",
    });
  }

  console.log(
    `[admin-delete-user] removed ${target.email} (portal_user_id=${portal_user_id}); steps=${JSON.stringify(steps)}`,
  );

  return jsonResp({
    ok: true,
    deleted_email: target.email,
    steps,
  });
});
