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
  const ghlMessageId: string | null = ghlData?.messageId || ghlData?.id || null;
  const ghlConversationId: string | null = ghlData?.conversationId || null;

  console.log(
    `[ghl-send-message] sent ${type} to ${ghl_contact_id} at ${ghl_location_id}`,
  );

  // Cache write. Without this, the portal's conversations view lags the
  // live GHL thread until the next sync-ghl-to-cache cycle (could be
  // minutes). Reps then text again thinking it failed, or pop GHL to
  // verify — both violate the "portal is source of truth" rule
  // (decision 2026-04-20). We mirror the shape that sync-ghl-to-cache
  // writes so the thread render treats this message identically to
  // ones pulled from GHL: direction/body/dateAdded/messageType are
  // load-bearing for the UI. Best-effort: if this write fails, we still
  // report success (GHL has the message) and log to sync_log so the
  // next sync will repair.
  const nowIso = new Date().toISOString();
  const messageTypeStr =
    type === "SMS"
      ? "TYPE_SMS"
      : type === "Email"
        ? "TYPE_EMAIL"
        : `TYPE_${type.toUpperCase()}`;
  const appended: Record<string, unknown> = {
    id: ghlMessageId || `srv-${Date.now()}`,
    body: message,
    direction: "outbound",
    status: "sent",
    source: "api",
    contactId: ghl_contact_id,
    locationId: ghl_location_id,
    conversationId: ghlConversationId,
    dateAdded: nowIso,
    dateUpdated: nowIso,
    attachments: [],
    contentType: type === "Email" ? "text/html" : "text/plain",
    messageType: messageTypeStr,
  };

  try {
    // Prefer lookup by conversation_id (authoritative from GHL's response).
    let convoRow: {
      id: string;
      ghl_conversation_id: string;
      full_thread: unknown;
    } | null = null;
    if (ghlConversationId) {
      const { data } = await adminClient
        .from("conversations")
        .select("id, ghl_conversation_id, full_thread")
        .eq("ghl_conversation_id", ghlConversationId)
        .maybeSingle();
      convoRow = (data as typeof convoRow) || null;
    }
    // Fallback: some GHL tenants drop conversationId on the response.
    // Use the (location, contact) pair — at most one live conversation
    // per contact per location in practice.
    if (!convoRow) {
      const { data } = await adminClient
        .from("conversations")
        .select("id, ghl_conversation_id, full_thread")
        .eq("ghl_location_id", ghl_location_id)
        .eq("ghl_contact_id", ghl_contact_id)
        .order("last_message_at", {
          ascending: false,
          nullsFirst: false,
        })
        .limit(1)
        .maybeSingle();
      convoRow = (data as typeof convoRow) || null;
    }

    const truncatedBody =
      message.length > 500 ? message.slice(0, 500) : message;

    if (convoRow) {
      const existing = Array.isArray(convoRow.full_thread)
        ? (convoRow.full_thread as unknown[])
        : [];
      const { error: upErr } = await adminClient
        .from("conversations")
        .update({
          full_thread: [...existing, appended],
          last_message_body: truncatedBody,
          last_message_type: messageTypeStr,
          last_message_at: nowIso,
          synced_at: nowIso,
        })
        .eq("id", convoRow.id);
      if (upErr) throw new Error(`update: ${upErr.message}`);
    } else if (ghlConversationId) {
      // New thread — GHL gave us the conversation_id, create the row.
      // Pull contact name for list-row display; null is fine if absent.
      const { data: contact } = await adminClient
        .from("contacts")
        .select("full_name, first_name, last_name")
        .eq("ghl_contact_id", ghl_contact_id)
        .maybeSingle();
      const contactName =
        (contact as any)?.full_name ||
        [(contact as any)?.first_name, (contact as any)?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        null;
      const { error: insErr } = await adminClient.from("conversations").insert({
        ghl_conversation_id: ghlConversationId,
        ghl_location_id,
        ghl_contact_id,
        contact_name: contactName,
        last_message_body: truncatedBody,
        last_message_type: messageTypeStr,
        last_message_at: nowIso,
        unread_count: 0,
        full_thread: [appended],
        synced_at: nowIso,
      });
      if (insErr) throw new Error(`insert: ${insErr.message}`);
    }
    // If we have neither a matching row nor a conversation_id from GHL,
    // skip — the next sync-ghl-to-cache run will discover and cache it.
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ghl-send-message] cache write failed: ${msg}`);
    try {
      await adminClient.from("sync_log").insert({
        status: "failed",
        sync_type: "send_message_cache",
        ghl_location_id,
        error_message: `cache write after send failed: ${msg.slice(0, 400)}`,
        started_at: nowIso,
        completed_at: new Date().toISOString(),
      });
    } catch {
      /* noop — don't block the success response on a log write */
    }
  }

  return jsonResp({
    ok: true,
    message_id: ghlMessageId,
    conversation_id: ghlConversationId,
    ghl: ghlData || null,
  });
});
