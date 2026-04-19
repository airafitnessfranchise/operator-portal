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

const VALID_METRICS = new Set([
  "close_rate",
  "show_rate",
  "appointment_rate",
  "adps",
  "other",
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

  const [{ data: role }, { data: callerId }] = await Promise.all([
    userClient.rpc("current_user_role"),
    userClient.rpc("current_user_id"),
  ]);
  if (role !== "vp" && role !== "admin") {
    return jsonResp({ ok: false, error: "vp or admin only" }, 403);
  }
  if (!callerId) {
    return jsonResp({ ok: false, error: "could not resolve user" }, 500);
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
  const focus_metric =
    typeof body?.focus_metric === "string"
      ? body.focus_metric.trim().toLowerCase()
      : "";
  const franchisee_name =
    typeof body?.franchisee_name === "string"
      ? body.franchisee_name.trim().slice(0, 200)
      : null;
  const note =
    typeof body?.note === "string" ? body.note.trim().slice(0, 140) : null;

  if (!ghl_location_id) {
    return jsonResp({ ok: false, error: "ghl_location_id is required" }, 400);
  }
  if (!VALID_METRICS.has(focus_metric)) {
    return jsonResp(
      { ok: false, error: `invalid focus_metric: ${focus_metric}` },
      400,
    );
  }

  // Access check: caller must have access to this location
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
    .select("id, ghl_location_id, name")
    .eq("ghl_location_id", ghl_location_id)
    .maybeSingle();
  if (locErr || !loc) {
    return jsonResp(
      {
        ok: false,
        error: `location lookup failed: ${locErr?.message || "not found"}`,
      },
      404,
    );
  }

  // 48-hour guardrail per coach+location
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await adminClient
    .from("coaching_sessions")
    .select("id, created_at")
    .eq("coach_user_id", callerId)
    .eq("location_id", loc.id)
    .gte("created_at", cutoff)
    .limit(1);
  if (recentErr) {
    return jsonResp(
      { ok: false, error: `guardrail check failed: ${recentErr.message}` },
      500,
    );
  }
  if (recent && recent.length > 0) {
    return jsonResp(
      {
        ok: false,
        error:
          "You already logged coaching here within the last 48 hours. Wait a couple days before logging a follow-up.",
      },
      409,
    );
  }

  // Capture baseline snapshot (7 days BEFORE today, server time)
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { data: snap, error: snapErr } = await adminClient.rpc(
    "_coaching_window_snapshot",
    {
      p_ghl_location_id: ghl_location_id,
      p_window_start: windowStart.toISOString(),
      p_window_end: windowEnd.toISOString(),
    },
  );
  if (snapErr) {
    return jsonResp(
      { ok: false, error: `snapshot failed: ${snapErr.message}` },
      500,
    );
  }
  const snapshot = Array.isArray(snap) && snap[0] ? snap[0] : null;
  let baseline_metric_value: number | null = null;
  if (snapshot) {
    if (focus_metric === "close_rate")
      baseline_metric_value = Number(snapshot.close_rate) || 0;
    else if (focus_metric === "show_rate")
      baseline_metric_value = Number(snapshot.show_rate) || 0;
    else if (focus_metric === "appointment_rate")
      baseline_metric_value = Number(snapshot.appointment_rate) || 0;
    else if (focus_metric === "adps")
      baseline_metric_value = Number(snapshot.adps) || 0;
    // 'other' → leave null
  }
  const baseline_dollars_on_table = snapshot
    ? Number(snapshot.dollars_on_table) || 0
    : 0;

  const today = new Date();
  const coached_on = today.toISOString().slice(0, 10);
  const review_due_at = new Date(
    today.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const baseline_window_start = windowStart.toISOString().slice(0, 10);
  const baseline_window_end = windowEnd.toISOString().slice(0, 10);

  const { data: inserted, error: insErr } = await adminClient
    .from("coaching_sessions")
    .insert({
      coach_user_id: callerId,
      location_id: loc.id,
      coached_on,
      focus_metric,
      franchisee_name,
      note,
      baseline_metric_value,
      baseline_dollars_on_table,
      baseline_window_start,
      baseline_window_end,
      review_due_at,
    })
    .select("*")
    .single();
  if (insErr || !inserted) {
    return jsonResp(
      { ok: false, error: `insert failed: ${insErr?.message}` },
      500,
    );
  }

  return jsonResp({ ok: true, session: inserted });
});
