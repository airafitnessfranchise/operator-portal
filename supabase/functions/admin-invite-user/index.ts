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

const VALID_ROLES = new Set([
  "admin",
  "regional_director",
  "vp",
  "franchisee",
  "manager",
  "sales_rep",
]);

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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: "invalid json body" }, 400);
  }

  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const full_name =
    typeof body?.full_name === "string" ? body.full_name.trim() : "";
  const userRole =
    typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  const locationGhlIds: string[] = Array.isArray(body?.location_ghl_ids)
    ? body.location_ghl_ids.filter(
        (x: unknown): x is string => typeof x === "string" && x.length > 0,
      )
    : [];
  const primaryLocationGhlId =
    typeof body?.primary_location_ghl_id === "string"
      ? body.primary_location_ghl_id.trim()
      : "";
  const links: Record<string, string | null> =
    body?.links && typeof body.links === "object" ? body.links : {};
  const redirectTo =
    typeof body?.redirect_to === "string" && body.redirect_to
      ? body.redirect_to
      : undefined;

  if (!email || !full_name || !userRole) {
    return jsonResp(
      { ok: false, error: "email, full_name, and role are required" },
      400,
    );
  }
  if (!VALID_ROLES.has(userRole)) {
    return jsonResp({ ok: false, error: `invalid role: ${userRole}` }, 400);
  }
  if (locationGhlIds.length === 0) {
    return jsonResp(
      { ok: false, error: "at least one location is required" },
      400,
    );
  }
  if (primaryLocationGhlId && !locationGhlIds.includes(primaryLocationGhlId)) {
    return jsonResp(
      {
        ok: false,
        error: "primary_location_ghl_id must be in location_ghl_ids",
      },
      400,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Reject duplicate email in public.users
  const { data: existing, error: existErr } = await adminClient
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existErr) {
    return jsonResp(
      { ok: false, error: `user lookup failed: ${existErr.message}` },
      500,
    );
  }
  if (existing) {
    return jsonResp(
      { ok: false, error: "a portal user with this email already exists" },
      409,
    );
  }

  // Resolve GHL link: primary location's link wins, then any non-null link
  let resolvedGhlUserId: string | null =
    (typeof links[primaryLocationGhlId] === "string"
      ? (links[primaryLocationGhlId] as string)
      : null) || null;
  if (!resolvedGhlUserId) {
    for (const loc of locationGhlIds) {
      const v = links[loc];
      if (typeof v === "string" && v.length > 0) {
        resolvedGhlUserId = v;
        break;
      }
    }
  }

  // Create the auth user directly (no email sent) with a throwaway password.
  // The new user completes setup via the portal's "Forgot password?" flow,
  // which sends them a single password-reset email from Supabase.
  // This avoids the invite-email rate limit on bulk onboarding.
  const throwawayPw =
    crypto.randomUUID().replace(/-/g, "") +
    "Aa1!" +
    crypto.randomUUID().slice(0, 8);
  const { data: created, error: createErr } =
    await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      password: throwawayPw,
    });
  if (createErr || !created?.user) {
    return jsonResp(
      {
        ok: false,
        error: createErr?.message || "failed to create auth user",
      },
      500,
    );
  }
  const authUserId = created.user.id;

  // Best-effort: generate a password-recovery link the admin can share manually.
  // If this fails (rate limit, email disabled, etc.), we continue silently —
  // the user can always click "Forgot password?" on the login screen.
  let recoveryLink: string | null = null;
  try {
    const linkOpts: Record<string, unknown> = {};
    if (redirectTo) linkOpts.redirectTo = redirectTo;
    const { data: linkData } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: linkOpts,
    });
    recoveryLink =
      (linkData as any)?.properties?.action_link ||
      (linkData as any)?.action_link ||
      null;
  } catch {
    /* noop — setup link is optional */
  }

  // Insert public.users
  const { data: userRow, error: userErr } = await adminClient
    .from("users")
    .insert({
      auth_user_id: authUserId,
      email,
      full_name,
      role: userRole,
      ghl_user_id: resolvedGhlUserId,
      active: true,
    })
    .select("*")
    .single();
  if (userErr || !userRow) {
    // Roll back auth user so a retry isn't blocked by "email exists"
    try {
      await adminClient.auth.admin.deleteUser(authUserId);
    } catch {
      /* noop */
    }
    const msg = userErr?.message || "";
    if (
      /users_ghl_user_id_key|duplicate key.*ghl_user_id/i.test(msg) ||
      (userErr as any)?.code === "23505"
    ) {
      return jsonResp(
        {
          ok: false,
          error:
            "That GHL staff member is already linked to another portal user",
        },
        409,
      );
    }
    return jsonResp({ ok: false, error: `users insert failed: ${msg}` }, 500);
  }

  // Resolve location UUIDs
  const { data: locs, error: locErr } = await adminClient
    .from("locations")
    .select("id, ghl_location_id")
    .in("ghl_location_id", locationGhlIds);
  if (locErr) {
    return jsonResp(
      { ok: false, error: `locations lookup failed: ${locErr.message}` },
      500,
    );
  }
  const ulRows = (locs || []).map(
    (l: { id: string; ghl_location_id: string }) => ({
      user_id: userRow.id,
      location_id: l.id,
      is_primary: l.ghl_location_id === primaryLocationGhlId,
    }),
  );
  if (ulRows.length > 0) {
    const { error: ulErr } = await adminClient
      .from("user_locations")
      .insert(ulRows);
    if (ulErr) {
      return jsonResp(
        {
          ok: false,
          error: `user_locations insert failed: ${ulErr.message}`,
          user: userRow,
        },
        500,
      );
    }
  }

  return jsonResp({
    ok: true,
    user: userRow,
    linked_ghl_user_id: resolvedGhlUserId,
    invited_auth_user_id: authUserId,
    recovery_link: recoveryLink,
  });
});
