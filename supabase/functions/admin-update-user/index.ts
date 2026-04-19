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

  const user_id = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  if (!user_id) {
    return jsonResp({ ok: false, error: "user_id is required" }, 400);
  }

  const raw = body?.updates || {};
  const locationGhlIds: string[] | null = Array.isArray(body?.location_ghl_ids)
    ? body.location_ghl_ids.filter(
        (x: unknown): x is string => typeof x === "string" && x.length > 0,
      )
    : null;
  const primaryLocationGhlId =
    typeof body?.primary_location_ghl_id === "string"
      ? body.primary_location_ghl_id.trim()
      : "";

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Build scalar updates (skip empty strings)
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    if (k === "full_name") {
      if (typeof v === "string" && v.trim().length > 0) {
        updates.full_name = v.trim();
      }
      continue;
    }
    if (k === "role") {
      if (typeof v === "string") {
        const r = v.trim().toLowerCase();
        if (!VALID_ROLES.has(r)) {
          return jsonResp({ ok: false, error: `invalid role: ${r}` }, 400);
        }
        updates.role = r;
      }
      continue;
    }
    if (k === "active") {
      if (typeof v === "boolean") updates.active = v;
      continue;
    }
    if (k === "ghl_user_id") {
      // null clears, string sets, empty-string skipped
      if (v === null) {
        updates.ghl_user_id = null;
      } else if (typeof v === "string") {
        const t = v.trim();
        if (t.length > 0) updates.ghl_user_id = t;
      }
      continue;
    }
    // Ignore unknown fields
  }

  if (Object.keys(updates).length === 0 && locationGhlIds === null) {
    return jsonResp({ ok: false, error: "no valid fields to update" }, 400);
  }

  let updatedUser: any = null;
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { data, error } = await adminClient
      .from("users")
      .update(updates)
      .eq("id", user_id)
      .select("*")
      .maybeSingle();
    if (error) {
      const msg = error.message || "";
      if (
        /users_ghl_user_id_key|duplicate key.*ghl_user_id/i.test(msg) ||
        (error as any).code === "23505"
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
      return jsonResp({ ok: false, error: `users update failed: ${msg}` }, 500);
    }
    if (!data) {
      return jsonResp({ ok: false, error: "user not found" }, 404);
    }
    updatedUser = data;
  } else {
    const { data } = await adminClient
      .from("users")
      .select("*")
      .eq("id", user_id)
      .maybeSingle();
    if (!data) {
      return jsonResp({ ok: false, error: "user not found" }, 404);
    }
    updatedUser = data;
  }

  // If location_ghl_ids supplied, replace user_locations
  if (locationGhlIds !== null) {
    if (
      primaryLocationGhlId &&
      !locationGhlIds.includes(primaryLocationGhlId)
    ) {
      return jsonResp(
        {
          ok: false,
          error: "primary_location_ghl_id must be in location_ghl_ids",
        },
        400,
      );
    }
    const { data: locs, error: locErr } = await adminClient
      .from("locations")
      .select("id, ghl_location_id")
      .in(
        "ghl_location_id",
        locationGhlIds.length > 0 ? locationGhlIds : ["__none__"],
      );
    if (locErr) {
      return jsonResp(
        { ok: false, error: `locations lookup failed: ${locErr.message}` },
        500,
      );
    }
    const locIds = (locs || []).map((l: { id: string }) => l.id);
    // Delete existing memberships
    const { error: delErr } = await adminClient
      .from("user_locations")
      .delete()
      .eq("user_id", user_id);
    if (delErr) {
      return jsonResp(
        { ok: false, error: `user_locations clear failed: ${delErr.message}` },
        500,
      );
    }
    if (locIds.length > 0) {
      const ulRows = (locs || []).map(
        (l: { id: string; ghl_location_id: string }) => ({
          user_id,
          location_id: l.id,
          is_primary: l.ghl_location_id === primaryLocationGhlId,
        }),
      );
      const { error: insErr } = await adminClient
        .from("user_locations")
        .insert(ulRows);
      if (insErr) {
        return jsonResp(
          {
            ok: false,
            error: `user_locations insert failed: ${insErr.message}`,
          },
          500,
        );
      }
    }
  }

  return jsonResp({ ok: true, user: updatedUser });
});
