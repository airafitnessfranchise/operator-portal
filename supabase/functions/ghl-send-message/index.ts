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

const ALLOWED_ROLES = new Set([
  "admin",
  "regional_director",
  "vp",
  "manager",
  "sales_rep",
  "franchisee",
]);

const ALLOWED_TYPES = new Set(["SMS", "Email"]);

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
  if (!role || !ALLOWED_ROLES.has(role)) {
    return jsonResp({ ok: false, error: "not allowed for your role" }, 403);
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
  const ghl_contact_id =
    typeof body?.ghl_contact_id === "string" ? body.ghl_contact_id.trim() : "";
  const type =
    typeof body?.type === "string"
      ? body.type.trim().toUpperCase() === "SMS"
        ? "SMS"
        : body.type.trim()
      : "SMS";
  const message = typeof body?.message === "string" ? body.message : "";

  if (!ghl_location_id || !ghl_contact_id || !message.trim()) {
    return jsonResp(
      {
        ok: false,
        error: "ghl_location_id, ghl_contact_id, and message are required",
      },
      400,
    );
  }
  if (!ALLOWED_TYPES.has(type)) {
    return jsonResp(
      {
        ok: false,
        error: `type must be one of: ${[...ALLOWED_TYPES].join(", ")}`,
      },
      400,
    );
  }

  // Caller must have access to the target location
  const { data: canAccess, error: accErr } = await userClient.rpc(
    "can_access_ghl_location",
    { p_ghl_location_id: ghl_location_id },
  );
  if (accErr || !canAccess) {
    return jsonResp({ ok: false, error: "no access to this location" }, 403);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: loc, error: locErr } = await adminClient
    .from("locations")
    .select("ghl_api_key")
    .eq("ghl_location_id", ghl_location_id)
    .maybeSingle();
  if (locErr || !loc) {
    return jsonResp(
      {
        ok: false,
        error: `location lookup failed: ${locErr?.message || "not found"}`,
      },
      500,
    );
  }
  if (!loc.ghl_api_key) {
    return jsonResp(
      {
        ok: false,
        error: "this location has no GHL API key configured",
      },
      400,
    );
  }

  const ghlRes = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loc.ghl_api_key}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type,
      contactId: ghl_contact_id,
      message,
    }),
  });
  if (!ghlRes.ok) {
    const text = await ghlRes.text();
    console.error(
      `[ghl-send-message] GHL POST failed ${ghlRes.status}: ${text.slice(0, 500)}`,
    );
    return jsonResp(
      {
        ok: false,
        error: `GHL send failed (${ghlRes.status}): ${text.slice(0, 300)}`,
      },
      502,
    );
  }
  const ghlData = await ghlRes.json().catch(() => ({}));

  console.log(
    `[ghl-send-message] sent ${type} to ${ghl_contact_id} at ${ghl_location_id}`,
  );

  return jsonResp({
    ok: true,
    message_id: ghlData?.messageId || ghlData?.id || null,
    conversation_id: ghlData?.conversationId || null,
    ghl: ghlData || null,
  });
});
