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

const DEFAULT_REDIRECT =
  "https://airafitnessfranchise.github.io/operator-portal/";

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
      : DEFAULT_REDIRECT;

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

  // ── Pre-flight: figure out which of three cases we're in ────────────
  // A) auth.users row AND public.users row both exist     → 409 friendly
  // B) auth.users row exists but NO public.users row      → re-link path
  // C) neither exists                                     → normal invite
  //
  // Branch B is what bit us with Jasmine Crago: April seed → orphan
  // cleanup removed public.users but left the auth row. A second invite
  // attempt would then hit "User already registered" from
  // inviteUserByEmail and dead-end the admin.
  const { data: portalExisting, error: portalExistErr } = await adminClient
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (portalExistErr) {
    return jsonResp(
      {
        ok: false,
        error: `portal user lookup failed: ${portalExistErr.message}`,
      },
      500,
    );
  }

  // admin.listUsers doesn't support server-side email filter in older
  // supabase-js versions, so we page through with perPage=200. Operator
  // portal has ~dozens of auth users, not thousands — one page covers it.
  // If it ever stops covering it we'll switch to a direct SQL read.
  let existingAuthUserId: string | null = null;
  try {
    const { data: authList, error: authListErr } =
      await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (authListErr) throw new Error(authListErr.message);
    const hit = (authList?.users || []).find(
      (u: { id: string; email?: string | null }) =>
        (u.email || "").toLowerCase() === email,
    );
    existingAuthUserId = hit?.id || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResp({ ok: false, error: `auth lookup failed: ${msg}` }, 500);
  }

  // Branch A: already a full portal user — friendly 409.
  if (portalExisting && existingAuthUserId) {
    return jsonResp(
      {
        ok: false,
        code: "already_portal_user",
        error:
          "This person is already a portal user. Edit their row instead of re-adding.",
      },
      409,
    );
  }
  // portal row exists but no auth row: treat as if it's a fully-seated
  // portal user — same friendly message. This shouldn't normally happen
  // (portal rows always point at an auth_user_id) but don't blindly
  // invite over it.
  if (portalExisting && !existingAuthUserId) {
    return jsonResp(
      {
        ok: false,
        code: "already_portal_user",
        error:
          "This person is already a portal user. Edit their row instead of re-adding.",
      },
      409,
    );
  }

  // Shared insert helpers so Branch B and Branch C write identical shapes.
  const insertPortalUser = async (authUserId: string) => {
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
    return { userRow, userErr };
  };

  const insertUserLocations = async (userId: string) => {
    const { data: locs, error: locErr } = await adminClient
      .from("locations")
      .select("id, ghl_location_id")
      .in("ghl_location_id", locationGhlIds);
    if (locErr) return { error: locErr };
    const ulRows = (locs || []).map(
      (l: { id: string; ghl_location_id: string }) => ({
        user_id: userId,
        location_id: l.id,
        is_primary: l.ghl_location_id === primaryLocationGhlId,
      }),
    );
    if (ulRows.length === 0) return { error: null };
    const { error: ulErr } = await adminClient
      .from("user_locations")
      .insert(ulRows);
    return { error: ulErr };
  };

  // ── Branch B: stranded auth — re-link ───────────────────────────────
  if (existingAuthUserId && !portalExisting) {
    const authUserId = existingAuthUserId;

    // Rollback chain: Branch B must NOT touch the auth user on failure
    // (it preexisted — leave it alone). Only clean up what we created.
    const { userRow, userErr } = await insertPortalUser(authUserId);
    if (userErr || !userRow) {
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

    const rollbackRelink = async () => {
      try {
        await adminClient
          .from("user_locations")
          .delete()
          .eq("user_id", userRow.id);
      } catch {
        /* noop */
      }
      try {
        await adminClient.from("users").delete().eq("id", userRow.id);
      } catch {
        /* noop */
      }
      // Deliberately: do NOT delete the auth user.
    };

    const { error: ulErr } = await insertUserLocations(userRow.id);
    if (ulErr) {
      await rollbackRelink();
      return jsonResp(
        {
          ok: false,
          error: `user_locations insert failed: ${ulErr.message}`,
        },
        500,
      );
    }

    // Send a password-reset link — the re-link equivalent of an invite
    // email. The user clicks it and lands on SetPasswordScreen. This is
    // Supabase's standard recovery flow, not a new invite, so it doesn't
    // 422 on "already registered."
    try {
      await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
    } catch (e) {
      // Non-fatal: the portal rows are in place; admin can resend from
      // the People list. Surface it in the response so the UI can warn.
      const linkErr = e instanceof Error ? e.message : String(e);
      return jsonResp({
        ok: true,
        relinked: true,
        user_id: userRow.id,
        email,
        user: userRow,
        linked_ghl_user_id: resolvedGhlUserId,
        reused_auth_user_id: authUserId,
        reset_link_warning: linkErr,
        message:
          "Relinked existing account, but the password-reset email failed to queue. Resend from the People list.",
      });
    }

    return jsonResp({
      ok: true,
      relinked: true,
      user_id: userRow.id,
      email,
      user: userRow,
      linked_ghl_user_id: resolvedGhlUserId,
      reused_auth_user_id: authUserId,
      message: "Sent password reset link to existing account.",
    });
  }

  // ── Branch C: brand-new invite (existing behavior, unchanged) ───────
  //
  // Send the invite. inviteUserByEmail creates the auth user AND dispatches
  // the invite email in a single call — the previous createUser + generateLink
  // flow never triggered mail.send, which is why portal-initiated invites
  // silently produced orphan auth rows with no email delivered.
  const { data: invited, error: inviteErr } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role: userRole },
      redirectTo,
    });
  if (inviteErr || !invited?.user) {
    return jsonResp(
      {
        ok: false,
        error: inviteErr?.message || "failed to invite user",
      },
      500,
    );
  }
  const authUserId = invited.user.id;

  // Helper: roll back the auth user if any subsequent step fails, so admin
  // can retry without hitting "email already exists" on the next attempt.
  const rollbackAuth = async () => {
    try {
      await adminClient.auth.admin.deleteUser(authUserId);
    } catch {
      /* noop */
    }
  };

  const { userRow, userErr } = await insertPortalUser(authUserId);
  if (userErr || !userRow) {
    await rollbackAuth();
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

  // Helper: roll back BOTH the public.users row and the auth user.
  const rollbackAll = async () => {
    try {
      await adminClient.from("users").delete().eq("id", userRow.id);
    } catch {
      /* noop */
    }
    await rollbackAuth();
  };

  const { error: ulErr } = await insertUserLocations(userRow.id);
  if (ulErr) {
    await rollbackAll();
    return jsonResp(
      {
        ok: false,
        error: `user_locations insert failed: ${ulErr.message}`,
      },
      500,
    );
  }

  return jsonResp({
    ok: true,
    success: true,
    relinked: false,
    user_id: userRow.id,
    email,
    user: userRow,
    linked_ghl_user_id: resolvedGhlUserId,
    invited_auth_user_id: authUserId,
  });
});
