import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

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

// Who can assign whom:
//   admin / regional_director / vp / manager  → any ghl_staff at that location
//   franchisee                                → any ghl_staff at their own location
//   sales_rep                                 → self only
const MANAGER_ROLES = new Set([
  "admin",
  "regional_director",
  "vp",
  "manager",
  "franchisee",
]);
const ALL_ALLOWED_ROLES = new Set([...MANAGER_ROLES, "sales_rep"]);

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

  const { data: role } = await userClient.rpc("current_user_role");
  if (!role || !ALL_ALLOWED_ROLES.has(role)) {
    return jsonResp({ ok: false, error: "not allowed for your role" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: "invalid json body" }, 400);
  }

  const opportunity_id =
    typeof body?.opportunity_id === "string" ? body.opportunity_id.trim() : "";
  const requestedGhlUserId =
    typeof body?.ghl_user_id === "string" ? body.ghl_user_id.trim() : "";
  if (!opportunity_id) {
    return jsonResp({ ok: false, error: "opportunity_id is required" }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look up opp → location
  const { data: opp, error: oppErr } = await adminClient
    .from("opportunities")
    .select("ghl_opportunity_id, ghl_location_id")
    .eq("ghl_opportunity_id", opportunity_id)
    .maybeSingle();
  if (oppErr || !opp) {
    return jsonResp(
      {
        ok: false,
        error: `opportunity lookup failed: ${oppErr?.message || "not found"}`,
      },
      404,
    );
  }

  // Caller must have access to this location
  const { data: canAccess, error: accErr } = await userClient.rpc(
    "can_access_ghl_location",
    { p_ghl_location_id: opp.ghl_location_id },
  );
  if (accErr || !canAccess) {
    return jsonResp({ ok: false, error: "no access to this location" }, 403);
  }

  // Resolve caller's own ghl_user_id at this location (needed for
  // sales_rep self-only check and for defaulting ghl_user_id).
  const { data: callerAuth } = await userClient.auth.getUser();
  const callerAuthId = callerAuth?.user?.id || null;
  let callerEmail: string | null = null;
  let callerGhlUserId: string | null = null;
  if (callerAuthId) {
    const { data: portalUser } = await adminClient
      .from("users")
      .select("email")
      .eq("auth_user_id", callerAuthId)
      .maybeSingle();
    callerEmail = portalUser?.email || null;
    if (callerEmail) {
      const { data: staffSelf } = await adminClient
        .from("ghl_staff")
        .select("ghl_user_id")
        .eq("ghl_location_id", opp.ghl_location_id)
        .ilike("email", callerEmail)
        .maybeSingle();
      callerGhlUserId = staffSelf?.ghl_user_id || null;
    }
  }

  // Determine target ghl_user_id. Default to caller's own if body didn't
  // supply one. Sales reps are self-only.
  let targetGhlUserId = requestedGhlUserId || callerGhlUserId;
  if (!targetGhlUserId) {
    return jsonResp(
      {
        ok: false,
        error:
          "no ghl_user_id provided and caller has no ghl_staff row at this location",
      },
      400,
    );
  }
  if (role === "sales_rep" && targetGhlUserId !== callerGhlUserId) {
    return jsonResp(
      {
        ok: false,
        error: "sales reps can only assign opportunities to themselves",
      },
      403,
    );
  }

  // Validate target exists in ghl_staff for this location
  const { data: targetRow } = await adminClient
    .from("ghl_staff")
    .select("ghl_user_id, full_name, email")
    .eq("ghl_location_id", opp.ghl_location_id)
    .eq("ghl_user_id", targetGhlUserId)
    .maybeSingle();
  if (!targetRow) {
    return jsonResp(
      {
        ok: false,
        error: "target ghl_user_id is not a staff member at this location",
      },
      400,
    );
  }

  // Pull PIT
  const { data: loc } = await adminClient
    .from("locations")
    .select("ghl_api_key")
    .eq("ghl_location_id", opp.ghl_location_id)
    .maybeSingle();
  if (!loc?.ghl_api_key) {
    return jsonResp(
      { ok: false, error: "location has no ghl_api_key configured" },
      400,
    );
  }

  // PUT to GHL
  const ghlRes = await fetch(
    `${GHL_BASE}/opportunities/${encodeURIComponent(opportunity_id)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${loc.ghl_api_key}`,
        Version: GHL_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assignedTo: targetGhlUserId }),
    },
  );
  if (!ghlRes.ok) {
    const text = await ghlRes.text();
    console.error(
      `[ghl-assign-opportunity] GHL PUT failed ${ghlRes.status}: ${text.slice(0, 500)}`,
    );
    return jsonResp(
      {
        ok: false,
        error: `GHL update failed (${ghlRes.status}): ${text.slice(0, 300)}`,
      },
      502,
    );
  }

  // Mirror into cache
  const { data: updated, error: cacheErr } = await adminClient
    .from("opportunities")
    .update({
      assigned_to: targetGhlUserId,
      synced_at: new Date().toISOString(),
      updated_at_ghl: new Date().toISOString(),
    })
    .eq("ghl_opportunity_id", opportunity_id)
    .select(
      "ghl_opportunity_id, ghl_location_id, ghl_contact_id, assigned_to, name, status, pipeline_stage_id",
    )
    .maybeSingle();
  if (cacheErr) {
    console.error(
      `[ghl-assign-opportunity] cache update failed: ${cacheErr.message}`,
    );
  }

  console.log(
    `[ghl-assign-opportunity] ${opportunity_id} → assignedTo=${targetGhlUserId} (${targetRow.full_name || targetRow.email || "unknown"})`,
  );

  return jsonResp({
    ok: true,
    opportunity: updated || null,
    assigned_to: targetGhlUserId,
    assigned_to_full_name: targetRow.full_name || null,
    assigned_to_email: targetRow.email || null,
  });
});
