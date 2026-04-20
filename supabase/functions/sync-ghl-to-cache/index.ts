import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const MAX_PAGES = 50;
const REQUEST_DELAY_MS = 150;
const APPT_WINDOW_PAST_DAYS = 7;
const APPT_WINDOW_FUTURE_DAYS = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toTimestamptz(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return new Date(v).toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

async function ghlFetch(
  pathOrUrl: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<any> {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${GHL_BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GHL ${init.method || "GET"} ${url} → ${res.status}: ${body.slice(0, 500)}`,
    );
  }
  return res.json();
}

async function syncContacts(
  supabase: SupabaseClient,
  apiKey: string,
  locationId: string,
  warnings: string[],
): Promise<number> {
  let nextUrl: string | null =
    `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=100`;
  let pages = 0;
  let total = 0;

  while (nextUrl && pages < MAX_PAGES) {
    const data = await ghlFetch(nextUrl, apiKey);
    const contacts: any[] = data.contacts || [];
    if (contacts.length === 0) break;

    const rows = contacts.map((c) => {
      const fullName = [c.firstName, c.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      return {
        ghl_contact_id: c.id,
        ghl_location_id: c.locationId || locationId,
        first_name: c.firstName || null,
        last_name: c.lastName || null,
        full_name: fullName || null,
        email: c.email || null,
        phone: c.phone || null,
        source: c.source || null,
        tags: Array.isArray(c.tags) ? c.tags : null,
        date_added: toTimestamptz(c.dateAdded),
        last_activity: toTimestamptz(c.lastActivity),
        assigned_to: c.assignedTo || null,
        custom_fields: c.customFields ?? null,
        raw: c,
        synced_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from("contacts")
      .upsert(rows, { onConflict: "ghl_contact_id" });
    if (error) throw new Error(`contacts upsert failed: ${error.message}`);

    total += rows.length;
    pages++;

    const meta = data.meta || {};
    if (meta.nextPageUrl) {
      nextUrl = meta.nextPageUrl;
    } else if (meta.startAfterId && meta.startAfter != null) {
      nextUrl =
        `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}` +
        `&limit=100&startAfterId=${encodeURIComponent(meta.startAfterId)}` +
        `&startAfter=${encodeURIComponent(String(meta.startAfter))}`;
    } else {
      nextUrl = null;
    }

    if (nextUrl) await sleep(REQUEST_DELAY_MS);
  }

  if (pages >= MAX_PAGES && nextUrl) {
    warnings.push(
      `contacts: hit MAX_PAGES cap (${MAX_PAGES}) for ${locationId}`,
    );
  }
  return total;
}

async function syncOpportunities(
  supabase: SupabaseClient,
  apiKey: string,
  locationId: string,
  warnings: string[],
): Promise<number> {
  let page = 1;
  let total = 0;
  const LIMIT = 100;

  while (page <= MAX_PAGES) {
    const data = await ghlFetch("/opportunities/search", apiKey, {
      method: "POST",
      body: JSON.stringify({ locationId, limit: LIMIT, page }),
    });
    const opps: any[] = data.opportunities || [];
    if (opps.length === 0) break;

    const rows = opps.map((o) => ({
      ghl_opportunity_id: o.id,
      ghl_location_id: o.locationId || locationId,
      ghl_contact_id: o.contactId || o.contact?.id || null,
      pipeline_id: o.pipelineId || null,
      pipeline_stage_id: o.pipelineStageId || null,
      name: o.name || null,
      status: o.status || null,
      monetary_value: o.monetaryValue != null ? Number(o.monetaryValue) : null,
      assigned_to: o.assignedTo || null,
      source: o.source || null,
      created_at_ghl: toTimestamptz(o.createdAt),
      updated_at_ghl: toTimestamptz(o.updatedAt),
      raw: o,
      synced_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("opportunities")
      .upsert(rows, { onConflict: "ghl_opportunity_id" });
    if (error) throw new Error(`opportunities upsert failed: ${error.message}`);

    total += rows.length;
    if (opps.length < LIMIT) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }

  if (page > MAX_PAGES) {
    warnings.push(
      `opportunities: hit MAX_PAGES cap (${MAX_PAGES}) for ${locationId}`,
    );
  }
  return total;
}

async function syncAppointments(
  supabase: SupabaseClient,
  apiKey: string,
  locationId: string,
  calendarId: string | null,
  warnings: string[],
): Promise<number> {
  if (!calendarId) {
    warnings.push(
      `appointments: skipped for ${locationId} (no ghl_calendar_id configured)`,
    );
    return 0;
  }

  const now = Date.now();
  const startMs = now - APPT_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000;
  const endMs = now + APPT_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000;

  // GHL /calendars/events requires epoch-millis timestamps and rejects
  // ISO 8601 silently (returns empty). Pin Version header to 2021-04-15
  // for this call only — the newer 2021-07-28 also returns empty on this route.
  const data = await ghlFetch(
    `/calendars/events?locationId=${encodeURIComponent(locationId)}` +
      `&calendarId=${encodeURIComponent(calendarId)}` +
      `&startTime=${startMs}` +
      `&endTime=${endMs}`,
    apiKey,
    { headers: { Version: "2021-04-15" } },
  );
  const rawEvents: any[] = data.events || data.appointments || [];
  const events = rawEvents.filter((e) => !e.deleted);
  if (events.length === 0) {
    const keys = Object.keys(data || {}).join(",") || "(none)";
    warnings.push(
      `appointments: 0 events returned for ${locationId} (calendarId=${calendarId}, response keys: ${keys}, raw_count: ${rawEvents.length})`,
    );
    return 0;
  }

  const rows = events.map((e) => ({
    ghl_event_id: e.id,
    ghl_location_id: e.locationId || locationId,
    ghl_contact_id: e.contactId || null,
    title: e.title || null,
    start_time: toTimestamptz(e.startTime),
    end_time: toTimestamptz(e.endTime),
    status: e.appointmentStatus || e.status || null,
    appointment_status: e.appointmentStatus || null,
    assigned_to: e.assignedUserId || e.assignedTo || null,
    raw: e,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("appointments")
    .upsert(rows, { onConflict: "ghl_event_id" });
  if (error) throw new Error(`appointments upsert failed: ${error.message}`);
  return rows.length;
}

function classifyStage(name: string): {
  counts_as_show: boolean;
  counts_as_no_show: boolean;
  counts_as_sale: boolean;
} {
  const n = (name || "").toLowerCase();
  const has = (terms: string[]) => terms.some((t) => n.includes(t));
  // Order matters: "no show" must be checked before "show"-ish terms.
  if (has(["sold", "won", "closed"])) {
    return {
      counts_as_show: true,
      counts_as_no_show: false,
      counts_as_sale: true,
    };
  }
  if (has(["no show", "no-show"])) {
    return {
      counts_as_show: false,
      counts_as_no_show: true,
      counts_as_sale: false,
    };
  }
  if (has(["booked", "confirmed", "showed", "appt", "pass"])) {
    return {
      counts_as_show: true,
      counts_as_no_show: false,
      counts_as_sale: false,
    };
  }
  // "lost", "not interested", "dead", "new lead", "new" — all default false.
  return {
    counts_as_show: false,
    counts_as_no_show: false,
    counts_as_sale: false,
  };
}

async function ensurePipeline(
  supabase: SupabaseClient,
  apiKey: string,
  locationId: string,
  existingPipelineId: string | null,
  warnings: string[],
): Promise<{ pipelineId: string | null; stagesDiscovered: number }> {
  if (existingPipelineId) {
    return { pipelineId: existingPipelineId, stagesDiscovered: 0 };
  }

  const data = await ghlFetch(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    apiKey,
  );
  const pipelines: any[] = data.pipelines || [];
  if (pipelines.length === 0) {
    warnings.push(
      `pipeline: no pipelines returned for ${locationId} — leaving pipeline_id null`,
    );
    return { pipelineId: null, stagesDiscovered: 0 };
  }

  const first = pipelines[0];
  const pipelineId: string | null = first.id || null;
  const stages: any[] = first.stages || [];

  if (!pipelineId) {
    warnings.push(
      `pipeline: first pipeline returned for ${locationId} has no id — leaving pipeline_id null`,
    );
    return { pipelineId: null, stagesDiscovered: 0 };
  }

  if (stages.length > 0) {
    const rows = stages.map((s, i) => {
      const flags = classifyStage(s.name || "");
      return {
        ghl_location_id: locationId,
        pipeline_id: pipelineId,
        ghl_stage_id: s.id,
        name: s.name || "Untitled",
        position: typeof s.position === "number" ? s.position : i,
        ...flags,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase
      .from("pipeline_stages")
      .upsert(rows, { onConflict: "ghl_stage_id" });
    if (error) {
      throw new Error(`pipeline_stages upsert failed: ${error.message}`);
    }
  }

  const { error: updErr } = await supabase
    .from("locations")
    .update({ pipeline_id: pipelineId })
    .eq("ghl_location_id", locationId);
  if (updErr) {
    warnings.push(
      `pipeline: stages saved but failed to set locations.pipeline_id for ${locationId}: ${updErr.message}`,
    );
  }

  return { pipelineId, stagesDiscovered: stages.length };
}

async function syncGhlStaff(
  supabase: SupabaseClient,
  apiKey: string,
  locationId: string,
  warnings: string[],
): Promise<number> {
  // GHL /users/?locationId=X requires Version 2021-07-28 (Probe 2 confirmed)
  const data = await ghlFetch(
    `/users/?locationId=${encodeURIComponent(locationId)}`,
    apiKey,
    { headers: { Version: "2021-07-28" } },
  );
  const users: any[] = data.users || [];
  if (users.length === 0) {
    warnings.push(`ghl_staff: 0 users returned for ${locationId}`);
    return 0;
  }

  const rows = users
    .filter((u) => u && u.id && !u.deleted)
    .map((u) => {
      const fullName =
        u.name ||
        [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
        null;
      const role = (u.roles && (u.roles.role || u.roles.type)) || null;
      return {
        ghl_location_id: locationId,
        ghl_user_id: u.id,
        email: u.email || null,
        first_name: u.firstName || null,
        last_name: u.lastName || null,
        full_name: fullName,
        role,
        synced_at: new Date().toISOString(),
      };
    });

  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from("ghl_staff")
    .upsert(rows, { onConflict: "ghl_location_id,ghl_user_id" });
  if (error) throw new Error(`ghl_staff upsert failed: ${error.message}`);
  return rows.length;
}

// Pull conversation metadata from /conversations/search and cap the
// number of full-thread /messages fetches per bulk sync so the whole
// run fits within the 150s edge-function budget. Threads beyond the
// cap get hydrated on-demand by ghl-get-conversation-thread when the
// user taps into a row. Search results are already sorted by
// last_message_date desc, so the top-N cap is exactly the "most
// recently active" slice.
const CONV_WINDOW_DAYS = 30;
const CONV_MAX_PAGES = 10;
const CONV_THREAD_FETCH_CAP = 40;

async function syncConversations(
  supabase: SupabaseClient,
  apiKey: string,
  locationId: string,
  warnings: string[],
): Promise<number> {
  const sinceMs = Date.now() - CONV_WINDOW_DAYS * 86400000;
  let startAfter: number | null = null;
  let startAfterId: string | null = null;
  let pages = 0;
  let total = 0;
  let threadsFetched = 0;
  let stop = false;

  while (!stop && pages < CONV_MAX_PAGES) {
    const qs = new URLSearchParams({
      locationId,
      limit: "100",
      sort: "desc",
      sortBy: "last_message_date",
    });
    if (startAfterId && startAfter != null) {
      qs.set("startAfterId", startAfterId);
      qs.set("startAfterDate", String(startAfter));
    }
    let data: any;
    try {
      data = await ghlFetch(`/conversations/search?${qs.toString()}`, apiKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`conversations: search failed for ${locationId}: ${msg}`);
      return total;
    }
    const convos: any[] = data.conversations || [];
    if (convos.length === 0) break;

    const rows: any[] = [];
    for (const c of convos) {
      const lastMsgAt =
        c.lastMessageDate ||
        c.lastMessageAt ||
        c.lastActivity ||
        c.updatedAt ||
        null;
      const lastMs = lastMsgAt ? new Date(lastMsgAt).getTime() : 0;
      if (lastMs && lastMs < sinceMs) {
        stop = true;
        break;
      }

      // Only hydrate the thread for the top CONV_THREAD_FETCH_CAP
      // conversations. The rest get their thread on-demand when tapped
      // (ghl-get-conversation-thread). GHL returns messages in
      // /messages.messages; some tenants nest under .messages[0].messages.
      let thread: any[] | null = null;
      if (threadsFetched < CONV_THREAD_FETCH_CAP) {
        try {
          const mData = await ghlFetch(
            `/conversations/${encodeURIComponent(c.id)}/messages`,
            apiKey,
          );
          const direct = mData?.messages?.messages || mData?.messages;
          thread = Array.isArray(direct) ? direct : [];
          threadsFetched++;
          await sleep(REQUEST_DELAY_MS);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          warnings.push(
            `conversations: messages fetch failed for ${c.id}: ${msg}`,
          );
        }
      }

      const contactName =
        c.fullName ||
        c.contactName ||
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
        null;

      const row: Record<string, unknown> = {
        ghl_conversation_id: c.id,
        ghl_location_id: c.locationId || locationId,
        ghl_contact_id: c.contactId || null,
        contact_name: contactName,
        last_message_body: c.lastMessageBody || null,
        last_message_type: c.lastMessageType || null,
        last_message_at: toTimestamptz(lastMsgAt),
        unread_count: typeof c.unreadCount === "number" ? c.unreadCount : 0,
        synced_at: new Date().toISOString(),
      };
      if (thread !== null) row.full_thread = thread;
      rows.push(row);
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("conversations")
        .upsert(rows, { onConflict: "ghl_conversation_id" });
      if (error) {
        warnings.push(`conversations upsert failed: ${error.message}`);
        return total;
      }
      total += rows.length;
    }

    pages++;
    const lastConvo = convos[convos.length - 1];
    const lastDate =
      lastConvo?.lastMessageDate ||
      lastConvo?.lastMessageAt ||
      lastConvo?.updatedAt;
    if (stop || convos.length < 100 || !lastDate) break;
    startAfterId = lastConvo.id;
    startAfter = new Date(lastDate).getTime();
    await sleep(REQUEST_DELAY_MS);
  }

  if (pages >= CONV_MAX_PAGES) {
    warnings.push(
      `conversations: hit CONV_MAX_PAGES (${CONV_MAX_PAGES}) for ${locationId}`,
    );
  }
  return total;
}

async function syncOneLocation(
  supabase: SupabaseClient,
  ghlLocationId: string,
  ghlCalendarId: string | null,
  ghlApiKey: string | null,
  existingPipelineId: string | null,
) {
  if (!ghlApiKey) {
    await supabase.from("sync_log").insert({
      status: "skipped",
      sync_type: "cache",
      ghl_location_id: ghlLocationId,
      error_message: "Skipped: no ghl_api_key configured.",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    return {
      ghl_location_id: ghlLocationId,
      ok: true,
      skipped: true,
      reason: "no ghl_api_key configured",
    };
  }

  const warnings: string[] = [];

  const { data: logRow, error: logErr } = await supabase
    .from("sync_log")
    .insert({
      status: "started",
      sync_type: "cache",
      ghl_location_id: ghlLocationId,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (logErr) console.error("sync_log insert failed:", logErr.message);
  const logId: string | undefined = logRow?.id;

  try {
    const contacts = await syncContacts(
      supabase,
      ghlApiKey,
      ghlLocationId,
      warnings,
    );
    await sleep(REQUEST_DELAY_MS);
    const opportunities = await syncOpportunities(
      supabase,
      ghlApiKey,
      ghlLocationId,
      warnings,
    );
    await sleep(REQUEST_DELAY_MS);
    const { pipelineId: resolvedPipelineId, stagesDiscovered } =
      await ensurePipeline(
        supabase,
        ghlApiKey,
        ghlLocationId,
        existingPipelineId,
        warnings,
      );
    if (stagesDiscovered > 0) await sleep(REQUEST_DELAY_MS);
    const appointments = await syncAppointments(
      supabase,
      ghlApiKey,
      ghlLocationId,
      ghlCalendarId,
      warnings,
    );
    await sleep(REQUEST_DELAY_MS);
    const staff = await syncGhlStaff(
      supabase,
      ghlApiKey,
      ghlLocationId,
      warnings,
    );
    await sleep(REQUEST_DELAY_MS);
    const conversations = await syncConversations(
      supabase,
      ghlApiKey,
      ghlLocationId,
      warnings,
    );

    const counts = {
      contacts,
      opportunities,
      appointments,
      staff,
      conversations,
      stages_discovered: stagesDiscovered,
    };

    if (logId) {
      const patch: Record<string, unknown> = {
        status: "success",
        completed_at: new Date().toISOString(),
        metadata: { counts, resolved_pipeline_id: resolvedPipelineId },
      };
      if (warnings.length) patch.error_message = warnings.join("; ");
      const { error } = await supabase
        .from("sync_log")
        .update(patch)
        .eq("id", logId);
      if (error)
        console.error("sync_log success update failed:", error.message);
    }

    await supabase
      .from("locations")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("ghl_location_id", ghlLocationId);

    return {
      ghl_location_id: ghlLocationId,
      ok: true,
      counts,
      pipeline_id: resolvedPipelineId,
      warnings,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`sync failed for ${ghlLocationId}:`, msg);
    if (logId) {
      const { error } = await supabase
        .from("sync_log")
        .update({
          status: "failed",
          error_message: msg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", logId);
      if (error)
        console.error("sync_log failure update failed:", error.message);
    }
    return { ghl_location_id: ghlLocationId, ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "method not allowed" }),
      { status: 405, headers: JSON_HEADERS },
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "missing env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requested =
    typeof body?.ghl_location_id === "string"
      ? body.ghl_location_id.trim()
      : "";

  let locQuery = supabase
    .from("locations")
    .select("ghl_location_id, ghl_calendar_id, ghl_api_key, pipeline_id")
    .eq("active", true);
  if (requested) locQuery = locQuery.eq("ghl_location_id", requested);

  const { data: locs, error: locErr } = await locQuery;
  if (locErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `locations query failed: ${locErr.message}`,
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  type LocRow = {
    ghl_location_id: string | null;
    ghl_calendar_id: string | null;
    ghl_api_key: string | null;
    pipeline_id: string | null;
  };

  const targets = (locs || [])
    .map((r: LocRow) => ({
      ghl_location_id: r.ghl_location_id,
      ghl_calendar_id: r.ghl_calendar_id,
      ghl_api_key: r.ghl_api_key,
      pipeline_id: r.pipeline_id,
    }))
    .filter(
      (
        r,
      ): r is {
        ghl_location_id: string;
        ghl_calendar_id: string | null;
        ghl_api_key: string | null;
        pipeline_id: string | null;
      } =>
        typeof r.ghl_location_id === "string" && r.ghl_location_id.length > 0,
    );

  if (targets.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        results: [],
        note: requested
          ? `no active location with ghl_location_id=${requested}`
          : "no active locations to sync",
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  const results = [];
  for (const t of targets) {
    const r = await syncOneLocation(
      supabase,
      t.ghl_location_id,
      t.ghl_calendar_id,
      t.ghl_api_key,
      t.pipeline_id,
    );
    results.push(r);
    await sleep(REQUEST_DELAY_MS);
  }

  const allOk = results.every((r) => r.ok);
  return new Response(JSON.stringify({ ok: allOk, results }), {
    status: allOk ? 200 : 500,
    headers: JSON_HEADERS,
  });
});
