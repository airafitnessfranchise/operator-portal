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
  if (!role || !ALLOWED_ROLES.has(role)) {
    return jsonResp({ ok: false, error: "not allowed for your role" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: "invalid json body" }, 400);
  }

  const ghl_conversation_id =
    typeof body?.ghl_conversation_id === "string"
      ? body.ghl_conversation_id.trim()
      : "";
  if (!ghl_conversation_id) {
    return jsonResp(
      { ok: false, error: "ghl_conversation_id is required" },
      400,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: conv, error: convErr } = await adminClient
    .from("conversations")
    .select("ghl_conversation_id, ghl_location_id")
    .eq("ghl_conversation_id", ghl_conversation_id)
    .maybeSingle();
  if (convErr || !conv) {
    return jsonResp(
      {
        ok: false,
        error: `conversation lookup failed: ${convErr?.message || "not found"}`,
      },
      404,
    );
  }

  const { data: canAccess } = await userClient.rpc("can_access_ghl_location", {
    p_ghl_location_id: conv.ghl_location_id,
  });
  if (!canAccess) {
    return jsonResp({ ok: false, error: "no access to this location" }, 403);
  }

  const { data: loc } = await adminClient
    .from("locations")
    .select("ghl_api_key")
    .eq("ghl_location_id", conv.ghl_location_id)
    .maybeSingle();
  if (!loc?.ghl_api_key) {
    return jsonResp(
      { ok: false, error: "no GHL API key configured for this location" },
      400,
    );
  }

  const res = await fetch(
    `${GHL_BASE}/conversations/${encodeURIComponent(ghl_conversation_id)}/messages`,
    {
      headers: {
        Authorization: `Bearer ${loc.ghl_api_key}`,
        Version: GHL_VERSION,
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    return jsonResp(
      {
        ok: false,
        error: `GHL messages fetch failed (${res.status}): ${text.slice(0, 300)}`,
      },
      502,
    );
  }
  const data = await res.json().catch(() => ({}));
  const direct = data?.messages?.messages || data?.messages;
  const thread: any[] = Array.isArray(direct) ? direct : [];

  await adminClient
    .from("conversations")
    .update({
      full_thread: thread,
      synced_at: new Date().toISOString(),
    })
    .eq("ghl_conversation_id", ghl_conversation_id);

  return jsonResp({ ok: true, thread });
});
