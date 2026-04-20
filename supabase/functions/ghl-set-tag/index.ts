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

// Any signed-in portal user with access to the contact's location can
// toggle tags. "AI Off" (the primary consumer) is a per-contact coaching
// signal and doesn't need admin gating — a rep who sees Closebot going
// sideways on their lead should be able to pause it on the spot.
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

  const contact_id =
    typeof body?.contact_id === "string" ? body.contact_id.trim() : "";
  const tag =
    typeof body?.tag === "string" ? body.tag.trim().toLowerCase() : "";
  const action =
    typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

  if (!contact_id || !tag) {
    return jsonResp(
      { ok: false, error: "contact_id and tag are required" },
      400,
    );
  }
  if (action !== "add" && action !== "remove") {
    return jsonResp(
      { ok: false, error: "action must be 'add' or 'remove'" },
      400,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the contact's location so we can enforce access + pull the
  // location's PIT. Service role bypasses RLS to find the row; the
  // caller's permission check runs against the resolved location below.
  const { data: contactRow, error: contactErr } = await adminClient
    .from("contacts")
    .select("ghl_contact_id, ghl_location_id, tags")
    .eq("ghl_contact_id", contact_id)
    .maybeSingle();
  if (contactErr || !contactRow) {
    return jsonResp(
      {
        ok: false,
        error: `contact lookup failed: ${contactErr?.message || "not found"}`,
      },
      404,
    );
  }

  const { data: canAccess, error: accErr } = await userClient.rpc(
    "can_access_ghl_location",
    { p_ghl_location_id: contactRow.ghl_location_id },
  );
  if (accErr || !canAccess) {
    return jsonResp({ ok: false, error: "no access to this location" }, 403);
  }

  const { data: loc, error: locErr } = await adminClient
    .from("locations")
    .select("ghl_api_key")
    .eq("ghl_location_id", contactRow.ghl_location_id)
    .maybeSingle();
  if (locErr || !loc?.ghl_api_key) {
    return jsonResp(
      {
        ok: false,
        error: "location has no ghl_api_key configured",
      },
      400,
    );
  }

  const url = `${GHL_BASE}/contacts/${encodeURIComponent(contact_id)}/tags`;
  const method = action === "add" ? "POST" : "DELETE";
  let ghlRes: Response;
  try {
    ghlRes = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${loc.ghl_api_key}`,
        Version: GHL_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: [tag] }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResp({ ok: false, error: `network error: ${msg}` }, 502);
  }
  if (!ghlRes.ok) {
    const text = await ghlRes.text();
    console.error(
      `[ghl-set-tag] GHL ${method} failed ${ghlRes.status}: ${text.slice(0, 500)}`,
    );
    return jsonResp(
      {
        ok: false,
        error: `GHL ${action} tag failed (${ghlRes.status}): ${text.slice(
          0,
          300,
        )}`,
      },
      502,
    );
  }

  // Mirror to the cache so the UI sees the change without waiting for
  // the next sync. Read-modify-write on contacts.tags (text[]). Race with
  // a concurrent sync is OK — both converge to the same end state.
  const existingTags: string[] = Array.isArray(contactRow.tags)
    ? (contactRow.tags as string[])
    : [];
  const lowerExisting = existingTags.map((t) => (t || "").toLowerCase());
  let nextTags: string[];
  if (action === "add") {
    nextTags = lowerExisting.includes(tag)
      ? existingTags
      : [...existingTags, tag];
  } else {
    nextTags = existingTags.filter((t) => (t || "").toLowerCase() !== tag);
  }

  const { error: upErr } = await adminClient
    .from("contacts")
    .update({ tags: nextTags, updated_at: new Date().toISOString() })
    .eq("ghl_contact_id", contact_id);
  if (upErr) {
    console.error(
      `[ghl-set-tag] contacts cache update failed: ${upErr.message}`,
    );
    // Non-fatal: GHL has the change. Next sync will repair the cache.
  }

  console.log(
    `[ghl-set-tag] ${action} "${tag}" on ${contact_id} @ ${contactRow.ghl_location_id}`,
  );

  return jsonResp({
    ok: true,
    contact_id,
    action,
    tag,
    tags: nextTags,
  });
});
