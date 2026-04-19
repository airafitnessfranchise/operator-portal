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

const ALLOWED_FIELDS = new Set([
  "name",
  "ghl_api_key",
  "ghl_calendar_id",
  "timezone",
  "phone",
  "pipeline_id",
  "active",
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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
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

  const ghl_location_id =
    typeof body?.ghl_location_id === "string"
      ? body.ghl_location_id.trim()
      : "";
  if (!ghl_location_id) {
    return jsonResp({ ok: false, error: "ghl_location_id is required" }, 400);
  }

  const updates: Record<string, unknown> = {};
  const raw = body?.updates || {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    if (v === undefined) continue; // explicit omission by client
    if (v === null) {
      // Explicit null clears the field
      updates[k] = null;
      continue;
    }
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 0) {
        updates[k] = trimmed;
      }
      // Empty-string is treated as "no change" — do NOT wipe existing value.
      continue;
    }
    if (typeof v === "boolean") {
      updates[k] = v;
    }
  }
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length <= 1) {
    return jsonResp({ ok: false, error: "no valid fields to update" }, 400);
  }

  const { data, error } = await userClient
    .from("locations")
    .update(updates)
    .eq("ghl_location_id", ghl_location_id)
    .select("*")
    .single();
  if (error) {
    return jsonResp(
      { ok: false, error: error.message || "update failed" },
      500,
    );
  }
  if (!data) {
    return jsonResp({ ok: false, error: "location not found" }, 404);
  }

  return jsonResp({ ok: true, location: data });
});
