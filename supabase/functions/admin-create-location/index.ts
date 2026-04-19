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
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!ghl_location_id || !name) {
    return jsonResp(
      { ok: false, error: "ghl_location_id and name are required" },
      400,
    );
  }

  const row: Record<string, unknown> = {
    ghl_location_id,
    name,
    active: body?.active === false ? false : true,
  };
  if (typeof body?.ghl_api_key === "string" && body.ghl_api_key.trim()) {
    row.ghl_api_key = body.ghl_api_key.trim();
  }
  if (
    typeof body?.ghl_calendar_id === "string" &&
    body.ghl_calendar_id.trim()
  ) {
    row.ghl_calendar_id = body.ghl_calendar_id.trim();
  }
  if (typeof body?.timezone === "string" && body.timezone.trim()) {
    row.timezone = body.timezone.trim();
  }
  if (typeof body?.phone === "string" && body.phone.trim()) {
    row.phone = body.phone.trim();
  }

  const { data, error } = await userClient
    .from("locations")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    const msg = error.message || "insert failed";
    const status = /duplicate|unique/i.test(msg) ? 409 : 500;
    return jsonResp({ ok: false, error: msg }, status);
  }

  return jsonResp({ ok: true, location: data });
});
