import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";

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

function toTimestamptz(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return new Date(v).toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
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
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResp({ ok: false, error: "missing env vars" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResp({ ok: false, error: "missing auth" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: "invalid json body" }, 400);
  }

  const {
    ghl_location_id,
    ghl_contact_id,
    start_time,
    end_time,
    assigned_user_id,
    title,
  } = body || {};

  if (
    !ghl_location_id ||
    !ghl_contact_id ||
    !start_time ||
    !end_time ||
    !assigned_user_id
  ) {
    return jsonResp(
      {
        ok: false,
        error:
          "missing required fields (ghl_location_id, ghl_contact_id, start_time, end_time, assigned_user_id)",
      },
      400,
    );
  }

  const { data: canAccess, error: accErr } = await userClient.rpc(
    "can_access_ghl_location",
    { p_ghl_location_id: ghl_location_id },
  );
  if (accErr) {
    return jsonResp(
      { ok: false, error: `access check failed: ${accErr.message}` },
      500,
    );
  }
  if (!canAccess) {
    return jsonResp(
      { ok: false, error: "access denied for this location" },
      403,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: loc, error: locErr } = await adminClient
    .from("locations")
    .select("ghl_api_key, ghl_calendar_id, timezone, name")
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
      { ok: false, error: "location has no ghl_api_key configured" },
      500,
    );
  }
  if (!loc.ghl_calendar_id) {
    return jsonResp(
      { ok: false, error: "location has no ghl_calendar_id configured" },
      500,
    );
  }

  let resolvedTitle: string =
    typeof title === "string" && title.trim() ? title.trim() : "";
  if (!resolvedTitle) {
    const { data: contact } = await adminClient
      .from("contacts")
      .select("full_name, first_name, last_name")
      .eq("ghl_contact_id", ghl_contact_id)
      .maybeSingle();
    const contactName =
      contact?.full_name ||
      [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
      "Contact";
    resolvedTitle = `Gym Tour - ${contactName}`;
  }

  const ghlPayload = {
    calendarId: loc.ghl_calendar_id,
    locationId: ghl_location_id,
    contactId: ghl_contact_id,
    startTime: start_time,
    endTime: end_time,
    title: resolvedTitle,
    appointmentStatus: "confirmed",
    assignedUserId: assigned_user_id,
    // Required on calendars with availability constraints (e.g. open-hours rules).
    // Manager/rep portal bookings should always bypass — they are trusted.
    ignoreFreeSlotValidation: true,
    ignoreDateRange: true,
  };

  let ghlRes: Response;
  try {
    ghlRes = await fetch(`${GHL_BASE}/calendars/events/appointments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loc.ghl_api_key}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(ghlPayload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResp({ ok: false, error: `network error: ${msg}` }, 502);
  }

  const rawText = await ghlRes.text();
  let ghlBody: any = null;
  try {
    ghlBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    ghlBody = { raw: rawText };
  }

  if (!ghlRes.ok) {
    try {
      await adminClient.from("sync_log").insert({
        status: "failed",
        sync_type: "book_appointment",
        ghl_location_id,
        error_message: `GHL ${ghlRes.status}: ${rawText.slice(0, 500)}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    } catch {
      /* noop */
    }
    const reason =
      (ghlBody && (ghlBody.message || ghlBody.error)) ||
      `HTTP ${ghlRes.status}`;
    return jsonResp(
      {
        ok: false,
        error: typeof reason === "string" ? reason : JSON.stringify(reason),
        status: ghlRes.status,
      },
      400,
    );
  }

  const event = ghlBody;
  const eventId = event?.id;
  if (!eventId) {
    return jsonResp(
      { ok: false, error: "GHL response missing event id", raw: event },
      500,
    );
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await adminClient.from("appointments").upsert(
    {
      ghl_event_id: eventId,
      ghl_location_id: event.locationId || ghl_location_id,
      ghl_contact_id: event.contactId || ghl_contact_id,
      title: event.title || resolvedTitle,
      start_time: toTimestamptz(event.startTime) || start_time,
      end_time: toTimestamptz(event.endTime) || end_time,
      status: event.appointmentStatus || "confirmed",
      appointment_status: event.appointmentStatus || "confirmed",
      // GHL may silently drop assignedUserId on unassigned calendars — record
      // both GHL's echo (if any) and the portal's intended assignment so
      // re-syncs can't null it out later.
      assigned_to: event.assignedUserId || assigned_user_id,
      portal_assigned_to: assigned_user_id,
      raw: event,
      synced_at: nowIso,
    },
    { onConflict: "ghl_event_id" },
  );
  if (upErr) {
    console.error("appointments upsert failed:", upErr.message);
  }

  // Aira's going-forward rule: the rep who booked the appointment also
  // owns the associated opportunity in GHL. Find any open opportunity
  // for this contact at this location and stamp assignedTo. If none
  // exists yet (e.g. contact hasn't been promoted to the pipeline),
  // we silently skip — Alyssa doesn't want a manual opportunity-create
  // step from the booking path.
  let opportunityAssigned: string | null = null;
  try {
    const { data: targetOpp } = await adminClient
      .from("opportunities")
      .select("ghl_opportunity_id, pipeline_id, status, updated_at_ghl")
      .eq("ghl_location_id", ghl_location_id)
      .eq("ghl_contact_id", ghl_contact_id)
      .neq("status", "lost")
      .neq("status", "abandoned")
      .order("updated_at_ghl", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (targetOpp?.ghl_opportunity_id) {
      const assignRes = await fetch(
        `${GHL_BASE}/opportunities/${encodeURIComponent(targetOpp.ghl_opportunity_id)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${loc.ghl_api_key}`,
            Version: "2021-07-28",
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ assignedTo: assigned_user_id }),
        },
      );
      if (assignRes.ok) {
        opportunityAssigned = targetOpp.ghl_opportunity_id;
        await adminClient
          .from("opportunities")
          .update({
            assigned_to: assigned_user_id,
            synced_at: new Date().toISOString(),
            updated_at_ghl: new Date().toISOString(),
          })
          .eq("ghl_opportunity_id", targetOpp.ghl_opportunity_id);
      } else {
        const bodyText = await assignRes.text();
        console.warn(
          `[ghl-book-appointment] opportunity assignment failed ${assignRes.status}: ${bodyText.slice(0, 300)}`,
        );
      }
    }
  } catch (e) {
    console.warn("[ghl-book-appointment] opportunity-assign step threw:", e);
  }

  return jsonResp({
    ok: true,
    event,
    opportunity_assigned: opportunityAssigned,
  });
});
