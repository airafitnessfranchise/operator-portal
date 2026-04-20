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

const ALLOWED_STATUS = new Set(["open", "won", "lost", "abandoned"]);

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

  const opportunity_id =
    typeof body?.opportunity_id === "string" ? body.opportunity_id.trim() : "";
  const pipeline_stage_id =
    typeof body?.pipeline_stage_id === "string"
      ? body.pipeline_stage_id.trim()
      : "";
  const requestedStatus =
    typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";

  // Sale-value fields per the Gross + MRR split (2026-04-20 decision).
  // gross_sale = total cash at close (enrollment + first month + PIF);
  // mrr = the monthly recurring membership rate. Both live on
  // public.opportunities; mrr is ALSO mirrored into GHL's monetaryValue
  // because that's what GHL's own UI has always displayed.
  // `undefined` = "don't touch" on all of these; `null` is an explicit
  // clear (e.g. edit demoting a prior PIF sale).
  const gross_sale: number | null | undefined =
    body?.gross_sale === undefined || body?.gross_sale === null
      ? body?.gross_sale
      : Number(body.gross_sale);
  if (
    gross_sale !== undefined &&
    gross_sale !== null &&
    (!Number.isFinite(gross_sale) || gross_sale < 0)
  ) {
    return jsonResp(
      { ok: false, error: "gross_sale must be a non-negative number" },
      400,
    );
  }
  const mrr: number | null | undefined =
    body?.mrr === undefined || body?.mrr === null
      ? body?.mrr
      : Number(body.mrr);
  if (mrr !== undefined && mrr !== null && (!Number.isFinite(mrr) || mrr < 0)) {
    return jsonResp(
      { ok: false, error: "mrr must be a non-negative number" },
      400,
    );
  }
  // Legacy: monetary_value still accepted (old callers). If the caller
  // didn't send mrr but did send monetary_value, treat it as mrr.
  const monetary_value_legacy: number | null | undefined =
    body?.monetary_value === undefined || body?.monetary_value === null
      ? body?.monetary_value
      : Number(body.monetary_value);
  if (
    monetary_value_legacy !== undefined &&
    monetary_value_legacy !== null &&
    (!Number.isFinite(monetary_value_legacy) || monetary_value_legacy < 0)
  ) {
    return jsonResp(
      { ok: false, error: "monetary_value must be a non-negative number" },
      400,
    );
  }
  const effective_mrr: number | null | undefined =
    mrr !== undefined ? mrr : monetary_value_legacy;
  const is_pif: boolean | null | undefined =
    typeof body?.is_pif === "boolean"
      ? body.is_pif
      : body?.is_pif === null
        ? null
        : undefined;

  if (!opportunity_id) {
    return jsonResp({ ok: false, error: "opportunity_id is required" }, 400);
  }
  if (
    !pipeline_stage_id &&
    !requestedStatus &&
    gross_sale === undefined &&
    effective_mrr === undefined &&
    is_pif === undefined
  ) {
    return jsonResp(
      {
        ok: false,
        error:
          "pipeline_stage_id, status, gross_sale, mrr, or is_pif must be provided",
      },
      400,
    );
  }
  if (requestedStatus && !ALLOWED_STATUS.has(requestedStatus)) {
    return jsonResp(
      {
        ok: false,
        error: `status must be one of: ${[...ALLOWED_STATUS].join(", ")}`,
      },
      400,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look up the opportunity so we can resolve its location + PIT.
  const { data: opp, error: oppErr } = await adminClient
    .from("opportunities")
    .select("ghl_opportunity_id, ghl_location_id, pipeline_id")
    .eq("ghl_opportunity_id", opportunity_id)
    .maybeSingle();
  if (oppErr) {
    return jsonResp(
      { ok: false, error: `opportunity lookup failed: ${oppErr.message}` },
      500,
    );
  }
  if (!opp) {
    return jsonResp({ ok: false, error: "opportunity not found" }, 404);
  }

  // Caller must have access to this opportunity's location (this is the
  // role gate tightening — RLS already covers contacts/opps/stages but
  // PIT access is service-role, so we enforce here.)
  const { data: canAccess, error: accErr } = await userClient.rpc(
    "can_access_ghl_location",
    { p_ghl_location_id: opp.ghl_location_id },
  );
  if (accErr || !canAccess) {
    return jsonResp({ ok: false, error: "no access to this location" }, 403);
  }

  // Pull the PIT + (optional) pipeline_id. We need pipelineId on the PUT
  // body because GHL requires it alongside pipelineStageId.
  const { data: loc, error: locErr } = await adminClient
    .from("locations")
    .select("ghl_location_id, ghl_api_key, pipeline_id")
    .eq("ghl_location_id", opp.ghl_location_id)
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

  // If the caller supplied a new stage but we don't know the pipeline_id,
  // fall back to whatever the stage row knows. pipeline_stages is keyed
  // on (ghl_location_id, ghl_stage_id).
  let resolvedPipelineId = opp.pipeline_id || loc.pipeline_id || null;
  let stageName: string | null = null;
  if (pipeline_stage_id) {
    const { data: stageRow } = await adminClient
      .from("pipeline_stages")
      .select("name, pipeline_id")
      .eq("ghl_location_id", opp.ghl_location_id)
      .eq("ghl_stage_id", pipeline_stage_id)
      .maybeSingle();
    if (stageRow) {
      stageName = stageRow.name || null;
      if (!resolvedPipelineId && stageRow.pipeline_id) {
        resolvedPipelineId = stageRow.pipeline_id;
      }
    }
  }
  if (pipeline_stage_id && !resolvedPipelineId) {
    return jsonResp(
      {
        ok: false,
        error:
          "cannot update stage: pipeline_id is unknown for this location — run a sync first",
      },
      400,
    );
  }

  // Resolve the acting user's ghl_user_id for THIS location. Aira's
  // going-forward rule (decision 2026-04-20): whenever a portal user
  // changes a stage, they get stamped as the opportunity's assigned
  // rep in GHL. ghl_staff is per-location, so the same portal user
  // can map to different ghl_user_ids across gyms. If no match is
  // found (e.g. portal-only VP with no GHL account at this location),
  // we skip the assignment, log an onboarding-gap warning, and let
  // the stage change succeed anyway.
  const { data: callerAuth } = await userClient.auth.getUser();
  const actingAuthUserId = callerAuth?.user?.id || null;
  let actingGhlUserId: string | null = null;
  let actingEmail: string | null = null;
  let actingFullName: string | null = null;
  let assignmentSkippedReason: string | null = null;
  if (actingAuthUserId) {
    const { data: portalUser } = await adminClient
      .from("users")
      .select("email, full_name")
      .eq("auth_user_id", actingAuthUserId)
      .maybeSingle();
    actingEmail = portalUser?.email || null;
    actingFullName = portalUser?.full_name || null;
    if (actingEmail) {
      const { data: staffRow } = await adminClient
        .from("ghl_staff")
        .select("ghl_user_id, full_name")
        .eq("ghl_location_id", opp.ghl_location_id)
        .ilike("email", actingEmail)
        .maybeSingle();
      if (staffRow?.ghl_user_id) {
        actingGhlUserId = staffRow.ghl_user_id;
        if (!actingFullName && staffRow.full_name) {
          actingFullName = staffRow.full_name;
        }
      } else {
        assignmentSkippedReason = `no ghl_staff row for ${actingEmail} at ${opp.ghl_location_id}`;
      }
    } else {
      assignmentSkippedReason = "caller has no email on public.users";
    }
  } else {
    assignmentSkippedReason = "could not resolve caller auth user";
  }

  const ghlBody: Record<string, unknown> = {};
  if (pipeline_stage_id) {
    ghlBody.pipelineStageId = pipeline_stage_id;
    if (resolvedPipelineId) ghlBody.pipelineId = resolvedPipelineId;
  }
  if (requestedStatus) {
    ghlBody.status = requestedStatus;
  }
  if (actingGhlUserId) {
    ghlBody.assignedTo = actingGhlUserId;
  }
  // GHL's only sale-value field is monetaryValue (monthly price). We
  // mirror mrr into it so GHL's own UI stays meaningful. gross_sale +
  // is_pif stay portal-only because GHL has no equivalent; the sync
  // never overwrites them.
  if (effective_mrr !== undefined) {
    ghlBody.monetaryValue = effective_mrr;
  }

  const ghlRes = await fetch(
    `${GHL_BASE}/opportunities/${encodeURIComponent(opportunity_id)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${loc.ghl_api_key}`,
        Version: GHL_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ghlBody),
    },
  );
  if (!ghlRes.ok) {
    const text = await ghlRes.text();
    console.error(
      `[ghl-update-opportunity] GHL PUT failed ${ghlRes.status}: ${text.slice(0, 500)}`,
    );
    return jsonResp(
      {
        ok: false,
        error: `GHL update failed (${ghlRes.status}): ${text.slice(0, 300)}`,
      },
      502,
    );
  }
  const ghlData = await ghlRes.json().catch(() => ({}));

  // Mirror the change into our cache so the UI reflects it before the
  // next sync runs. We leave raw alone — the next sync will overwrite.
  const cachePatch: Record<string, unknown> = {
    synced_at: new Date().toISOString(),
    updated_at_ghl: new Date().toISOString(),
  };
  if (pipeline_stage_id) {
    cachePatch.pipeline_stage_id = pipeline_stage_id;
    if (resolvedPipelineId) cachePatch.pipeline_id = resolvedPipelineId;
  }
  if (requestedStatus) cachePatch.status = requestedStatus;
  if (actingGhlUserId) cachePatch.assigned_to = actingGhlUserId;
  // Sale-value mirror: gross_sale + mrr per the 2026-04-20 split,
  // plus monetary_value kept in sync with mrr for backwards compat
  // with any pre-split callers. sold_at is stamped whenever gross_sale
  // OR mrr is set — a fresh close or an edit that sharpens either
  // number. We overwrite either way; the old value was the wrong one.
  if (gross_sale !== undefined) cachePatch.gross_sale = gross_sale;
  if (effective_mrr !== undefined) {
    cachePatch.mrr = effective_mrr;
    cachePatch.monetary_value = effective_mrr;
  }
  if (gross_sale !== undefined || effective_mrr !== undefined) {
    cachePatch.sold_at = new Date().toISOString();
  }
  if (is_pif !== undefined) cachePatch.is_pif = is_pif;

  const { data: updated, error: updateErr } = await adminClient
    .from("opportunities")
    .update(cachePatch)
    .eq("ghl_opportunity_id", opportunity_id)
    .select(
      "ghl_opportunity_id, ghl_location_id, ghl_contact_id, pipeline_id, pipeline_stage_id, status, name, assigned_to, monetary_value, gross_sale, mrr, is_pif, sold_at, updated_at_ghl",
    )
    .maybeSingle();
  if (updateErr) {
    console.error(
      `[ghl-update-opportunity] cache patch failed: ${updateErr.message}`,
    );
  }

  // Onboarding-gap signal: caller changed a stage but we couldn't
  // auto-assign them. Surface through sync_log so admin → Health can
  // see who's missing a ghl_staff row where.
  if (assignmentSkippedReason) {
    try {
      await adminClient.from("sync_log").insert({
        status: "success",
        sync_type: "opportunity_update_no_assign",
        ghl_location_id: opp.ghl_location_id,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: `assignedTo skipped: ${assignmentSkippedReason}`,
        metadata: {
          opportunity_id,
          acting_email: actingEmail,
          acting_auth_user_id: actingAuthUserId,
        },
      });
    } catch (e) {
      console.warn(
        `[ghl-update-opportunity] sync_log warning insert failed:`,
        e,
      );
    }
  }

  console.log(
    `[ghl-update-opportunity] ${opportunity_id} → stage=${pipeline_stage_id || "-"} status=${requestedStatus || "-"} assignedTo=${actingGhlUserId || "-"}`,
  );

  return jsonResp({
    ok: true,
    opportunity: updated || null,
    stage_name: stageName,
    assigned_to_caller: !!actingGhlUserId,
    acting_ghl_user_id: actingGhlUserId,
    acting_full_name: actingFullName,
    assignment_skipped_reason: assignmentSkippedReason,
    ghl: ghlData?.opportunity || ghlData || null,
  });
});
