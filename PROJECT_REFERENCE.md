# Aira Operator Portal — Project Reference

**Last updated:** April 21, 2026 (post-Phase 9.5: Leads + Conversations wired live)
**Owner:** Mike Bell
**Purpose:** Single source of truth for what we're building, why, and how everything connects.

---

## TABLE OF CONTENTS

1. [What This Is](#1-what-this-is)
2. [Why We're Building It](#2-why-were-building-it)
3. [The 18-Month Vision](#3-the-18-month-vision)
4. [Current Status — What's Shipped](#4-current-status--whats-shipped)
5. [What We're Building Next](#5-what-were-building-next)
6. [Technical Architecture](#6-technical-architecture)
7. [Infrastructure & Credentials](#7-infrastructure--credentials)
8. [The Aira Benchmarks That Power the Portal](#8-the-aira-benchmarks-that-power-the-portal)
9. [File Structure & Key Locations](#9-file-structure--key-locations)
10. [Terminal Commands You'll Use](#10-terminal-commands-youll-use)
11. [Troubleshooting & Known Issues](#11-troubleshooting--known-issues)
12. [Roadmap](#12-roadmap)
13. [How to Onboard a New Location](#13-how-to-onboard-a-new-location)

---

## 1. WHAT THIS IS

The Aira Operator Portal is a custom-built, mobile-first Progressive Web App (PWA) that replaces GoHighLevel's $497/month white-label app for Aira Fitness franchisees.

**But it's more than a replacement.** It's purpose-built to be a **management weapon** — a tool that gives VPs and Regional Directors the ability to see which franchisees need coaching today, what's broken, and how much revenue is being left on the table. It enforces the Aira operating system rather than exposing a generic CRM.

**Live URL:** https://airafitnessfranchise.github.io/operator-portal/
**Repo:** https://github.com/airafitnessfranchise/operator-portal
**Local path:** `~/Downloads/operator-portal`

---

## 2. WHY WE'RE BUILDING IT

Three compounding problems we're solving:

**Problem 1 — GHL's white-label app is expensive and generic.** $497/mo per reseller license, and it shows franchisees every CRM feature under the sun when they really need four: see leads, text them, book appointments, check performance. The noise hurts execution.

**Problem 2 — VPs are flying blind.** Alyssa and Jasmine (Aira's VPs) have no single view of their territories. They bounce between GHL, a Google Sheet tracker, text messages, and Zoom calls to figure out which franchisees need help. By the time they diagnose a problem, it's often three weeks old.

**Problem 3 — Franchisees drift from the Aira system.** The 5-Day Training teaches a specific playbook (Rule of 3, Deaf Ear, $220 ADPS, 40 memberships/mo). Without real-time visibility, it's too easy for a franchisee to silently stop running the system and waive fees, skip evening calls, or let leads go cold.

**The Portal Solves All Three By:**

- Giving operators a simple, focused app that only shows what matters
- Giving VPs a territory-wide triage view that ranks franchisees by who needs help most
- Measuring real Aira benchmarks (30-60% lead-to-sale, Rule of 3 diagnosis) and surfacing gaps in dollars

---

## 3. THE 18-MONTH VISION

The portal is Phase 1 of a bigger goal: **Aira owns its technology stack.** Every location runs on Aira infrastructure, not third-party SaaS. This is a strategic differentiator for franchise sales and a moat against competitors like Planet Fitness or Orangetheory.

**Strategic direction chosen April 18, 2026:**

> "Give VPs and Alyssa a weapon so franchisees actually hit their numbers."

We're building a **management tool**, not just a dashboard. The portal's job is to demand action, not display data.

---

## 4. CURRENT STATUS — WHAT'S SHIPPED

As of April 18, 2026, the following is live and working:

### Phase 1-5: Core Portal ✅ SHIPPED

| Feature                                                           | Status  | Notes                                   |
| ----------------------------------------------------------------- | ------- | --------------------------------------- |
| PWA shell (HTML, React CDN, Babel)                                | ✅ Live | No build step. Single `index.html`.     |
| Mobile-first design (Aira branded)                                | ✅ Live | Dark theme, DM Sans + Outfit fonts      |
| Supabase authentication (email+password)                          | ✅ Live | No magic links — Mike's decision        |
| Role-based access (admin, vp, rd, franchisee, manager, sales_rep) | ✅ Live | RLS enforced at DB level                |
| Multi-location user access                                        | ✅ Live | `user_locations` join table             |
| Single-location dashboard with real KPIs                          | ✅ Live | Pulled from Supabase cache              |
| Territory Dashboard (multi-location summary)                      | ✅ Live | Default view for VP/admin users         |
| Back-to-territory navigation                                      | ✅ Live | Chip below header in location view      |
| Per-location API credentials                                      | ✅ Live | Each location has own PIT stored in DB  |
| Auto-discovery of pipelines + stage flags                         | ✅ Live | Via heuristic on stage names            |
| GHL-to-Supabase sync (Edge Function)                              | ✅ Live | On-demand; caches contacts, opps, appts |
| GitHub Pages deployment                                           | ✅ Live | Auto-deploys on push to `main`          |
| Settings drawer with logout                                       | ✅ Live | Leaderboard hidden for sales_rep role   |

### Phase 6: Multi-Location Scaling + VP Territory Dashboard ✅ SHIPPED

| Feature                                             | Status  | Notes                                                                                                      |
| --------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| Per-location PIT credentials                        | ✅ Live | Each gym's own `ghl_api_key` stored in `public.locations`                                                  |
| Auto-discovery of pipelines + stages                | ✅ Live | Heuristic classifier (sold/won/closed → sale, no show → no_show, booked/confirmed/showed/appt/pass → show) |
| Territory Dashboard for multi-location users        | ✅ Live | Aggregate KPIs across all accessible locations + per-location cards                                        |
| Back-to-territory navigation                        | ✅ Live | Chip in header when drilled into a single location                                                         |
| Skip-with-warning for locations missing credentials | ✅ Live | Sync logs a `sync_log` warning and moves on                                                                |

### Phase 7: VP Triage View ✅ SHIPPED

| Feature                                                  | Status  | Notes                                                                   |
| -------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `location_triage` RPC with Rule-of-3 diagnosis           | ✅ Live | Returns `status_color` + `primary_diagnosis` per location               |
| Triage-mode default when any location is red             | ✅ Live | Persisted via `aira_view_mode` localStorage key                         |
| Floor-gap dollar math ($419/sale assumption)             | ✅ Live | = (floor_target − actual) × 419                                         |
| Ad-lead vs Extra-Credit source classification            | ✅ Live | Only ad leads count toward the 30/60 floor math                         |
| Rule-of-3 priority ladder                                | ✅ Live | Calls → Appointments → Shows → Closing → ADPS; first broken step wins   |
| Appointment-status-driven metrics (GHL real statuses)    | ✅ Live | `confirmed` / `showed` / `noshow` / `cancelled` from GHL                |
| Awaiting-update signal (confirmed appts past start_time) | ✅ Live | Amber subtext when > 5 per location                                     |
| Call logging with "How'd it go?" modal                   | ✅ Live | Tap-to-call marks pending intent; modal prompts on return to portal     |
| Call discipline triage signals                           | ✅ Live | "Not calling today" + "Leads going cold" surface before other diagnoses |

### Phase 8: Rep Dashboards + GHL Write-back ✅ SHIPPED

| Feature                                                        | Status  | Notes                                                                                         |
| -------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `rep_personal_kpis` RPC                                        | ✅ Live | Per-rep scorecard, scoped against Aira benchmarks                                             |
| `location_team_kpis` RPC                                       | ✅ Live | Team roll-up powering the manager/VP drill view                                               |
| Personal Dashboard for sales reps                              | ✅ Live | Sales reps never see the gym-wide view; empty-state onboarding when all-zero                  |
| Team This Month section (managers/VPs)                         | ✅ Live | Per-rep mini-cards, color-coded against Aira standards, tap to drill                          |
| `ghl-book-appointment` Edge Function                           | ✅ Live | Writes to GHL calendar + immediately caches locally                                           |
| BookAppointmentModal with contact search + auto-rep-assignment | ✅ Live | Falls back to a manager's ghl_user_id when caller has none (e.g., Mike)                       |
| `portal_assigned_to` column on appointments                    | ✅ Live | Preserves rep assignment across re-syncs (GHL drops `assignedUserId` on unassigned calendars) |
| Real-data Appointments screen                                  | ✅ Live | Auto-sync on mount, ↻ Refresh, status pills, "show cancelled" toggle                          |

### Phase 9: Admin Onboarding Suite ✅ SHIPPED

| Feature                                                                     | Status  | Notes                                                                          |
| --------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| ⚙️ Admin Onboarding entry point (admin-only)                                | ✅ Live | In the Settings drawer, opens a full-screen three-tab overlay                  |
| **Locations tab**: add / edit / sync / pipeline-stage editor                | ✅ Live | `admin-create-location` + `admin-update-location` Edge Functions               |
| Inline pipeline-stage flag toggles                                          | ✅ Live | `pipeline_stages_admin_write` RLS policy for admin-only writes                 |
| `ghl_staff` cache table (synced per location)                               | ✅ Live | Sync pulls `GET /users/?locationId=X` into a cache admin UIs read from         |
| **People tab**: invite, link to GHL staff, edit role/locations, remove      | ✅ Live | `admin-invite-user` + `admin-update-user` + `admin-delete-user` Edge Functions |
| Auto-match by email when linking to existing GHL staff                      | ✅ Live | Falls back to neutral "Portal-only" pill (no warning)                          |
| Portal-only user architecture                                               | ✅ Live | `users.ghl_user_id = null` is a fully supported state                          |
| Friendly 409 on duplicate GHL staff link                                    | ✅ Live | `users_ghl_user_id_key` constraint mapped to clean error                       |
| **Health tab**: status cards + integrity checks + sync-all + sync_log table | ✅ Live | `sync_log` has admin-only RLS SELECT                                           |

### Phase 9.5: Leads, Conversations, Invite Flow ✅ SHIPPED (April 20–21, 2026)

- **Leads screen live on real data** — queries `opportunities` + `contacts` + `pipeline_stages` scoped to the selected location, or aggregated across accessible locations in Territory/Triage view. Sorted newest-first. Default filter hides sales + lost/abandoned with a "Show closed" toggle. Stage-name pill switcher + name/email/phone search. Status shown as dot + uppercase label (green for shows/sales, red for no-shows, Aira Blue default).
- **Lead status write-back to GHL** — "Change Stage" chips on LeadDetail call `ghl-update-opportunity` with optimistic UI, toast on success, rollback + error toast on failure.
- **Conversations screen live on real data** — new `public.conversations` cache table, messages threaded inbound/outbound, 30-day window. Top-40 per location hydrated inline during sync; remainder lazy-loaded on tap via `ghl-get-conversation-thread`.
- **SMS send from portal** — Enter-to-send with optimistic append through `ghl-send-message`. Fully replaces any operator need to open GHL for texting.
- **Bottom-nav aggregation** — VP/admin in Territory/Triage view sees "All Leads" / "All Messages" across accessible locations with 📍 location tags. Drill into a gym = scoped to that gym. Single-location users unchanged.
- **Invite flow fixed end-to-end** — `admin-invite-user` now uses `auth.admin.inviteUserByEmail`, triggers `mail.send`, creates paired `public.users` row + `user_locations` links with a full rollback chain. `SetPasswordScreen` handles `type=invite` and `type=recovery` URL hashes, forces password creation before first login, and gracefully handles expired links with an "Ask your admin to resend" gate.

### Locations Configured

- **Aira Fitness Fox Lake** (pilot) — fully synced
- **Aira Fitness Mishawaka** — fully synced, auto-discovered pipeline

---

## 5. WHAT WE'RE BUILDING NEXT

The previous Phase 7 → 9 plan (VP Triage → Coaching Tracker → Accountability Loop) is now partially shipped: Phase 7 (VP Triage) is live. Phase 8 and Phase 9 ended up being different work (rep dashboards, write-back, admin onboarding) — so the two Alyssa-focused deep cuts have been renumbered to **Phase 10** and **Phase 11**.

### Between Phase 9.5 and Phase 10: Field Validation Window 🧪 IN PROGRESS

Before starting Phase 10, run live validation with Alyssa (VP) on Fox Lake + Mishawaka data:

1. Leads screen shows accurate counts vs. GHL
2. Lead status changes in portal actually reflect in GHL (round-trip test)
3. Conversations thread loads correctly for at least 5 recent contacts
4. SMS send from portal delivers and appears in GHL
5. Alyssa reports what's missing or confusing after 48 hours of real use

**Known-unknown:** the portal currently trusts GHL-side stage flags. If a franchisee renames a stage in GHL, the portal's diagnosis logic may silently break. Watch for this during validation.

### Phase 10: Coaching Action Tracker

When Alyssa opens a red location in the Triage view, she logs what action she took ("Called Jasmine, coached on Deaf Ear close, sending bootcamp script Monday"). Timestamped, searchable, attached to the location. Gives the org a memory of coaching and turns the Triage from read-only observation into a workflow.

**Likely shape:**

- "Log coaching action" button on each triage card
- Modal: free-text note + optional `metric_targeted` (close rate / show rate / booked rate)
- New `coaching_actions` table (location, user_id, note, metric_targeted, created_at)
- Chronological log visible on the single-location dashboard

### Phase 11: Accountability Loop

A week after Alyssa logs an action, the portal tells her whether it worked ("You coached Jasmine on close rate April 18. Close rate since: 18% → 34%. Action worked."). Forces measurement of the VP layer itself — the people who coach the people who run the gyms.

**Likely shape:**

- Background job (cron) reads open `coaching_actions` older than 7 days
- Compares the targeted metric over the follow-up window
- Posts a review card back to the VP with ✓ / ✗ / flat
- Rolls up into a "Your Impact" page: how often Alyssa's coaching moves the needle

---

## 6. TECHNICAL ARCHITECTURE

### The Stack

```
┌─────────────────────────────────────────────┐
│ BROWSER (user's phone or desktop)           │
│ • HTML + React 18 (CDN) + Babel (inline)    │
│ • PWA manifest for add-to-home-screen       │
│ • Supabase-js client for auth + data        │
└────────────────┬────────────────────────────┘
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────┐
│ GITHUB PAGES (static hosting)               │
│ • Serves index.html, manifest.json, icons   │
│ • Auto-deploys on push to main              │
└─────────────────────────────────────────────┘
                 │
                 │ API calls
                 ▼
┌─────────────────────────────────────────────┐
│ SUPABASE (Postgres + Auth + Edge Functions) │
│ • Auth: email/password + invite URL hash    │
│ • Postgres: locations, users, user_locations│
│   contacts, opportunities, appointments,    │
│   conversations, pipelines, pipeline_stages,│
│   ghl_staff, sync_log, coaching_sessions    │
│ • RLS policies enforce role + location      │
│ • RPCs: dashboard_kpis, territory_kpis,     │
│   rep_leaderboard, location_triage,         │
│   coaching_vp_scorecard                     │
│ • Edge Functions: see Section 7             │
└────────────────┬────────────────────────────┘
                 │ Scheduled or on-demand sync
                 ▼
┌─────────────────────────────────────────────┐
│ GOHIGHLEVEL (source of truth)               │
│ • Each location has its own PIT             │
│ • Endpoints: /contacts, /opportunities,     │
│   /conversations, /calendars/events,        │
│   /opportunities/pipelines                  │
└─────────────────────────────────────────────┘
```

### Data Flow

1. **User logs in** → Supabase auth creates session → client receives JWT
2. **App queries Supabase RPCs** → RLS enforces that only the user's locations are visible
3. **RPCs read from cached tables** (`contacts`, `opportunities`, `appointments`) — NOT directly from GHL
4. **Cache is refreshed** by the `sync-ghl-to-cache` Edge Function, which:
   - Reads each active location's `ghl_api_key` from the DB
   - Pulls all contacts, opportunities, and appointments (if calendar mapped)
   - Auto-discovers pipelines for new locations
   - Upserts into the cache tables
5. **Dashboards render instantly** because everything is pre-computed in Postgres

### Why This Architecture

- **Zero cost per user session** — no LLM calls, no AI middleman, just direct DB reads
- **Fast** — Postgres queries in <100ms vs. 3-5 seconds hitting GHL API
- **Scales** — adding a new location is one DB row, not a code change
- **Secure** — GHL API keys never leave the Edge Function; browser never touches GHL directly
- **Offline-tolerant** — cached data still works if GHL's API is down

---

## 7. INFRASTRUCTURE & CREDENTIALS

> ⚠️ **Security note:** This document contains credentials. Treat it as sensitive. Do not commit to public repos.

### GitHub

- **Org:** airafitnessfranchise
- **Repo:** operator-portal
- **URL:** https://github.com/airafitnessfranchise/operator-portal
- **Deployment:** GitHub Pages, auto-deploys on push to `main`
- **Live site:** https://airafitnessfranchise.github.io/operator-portal/

### Supabase

- **Project name:** aira-operator-portal
- **Project ref:** `rgpfzactcqbvadthzsgx`
- **URL:** https://rgpfzactcqbvadthzsgx.supabase.co
- **Dashboard:** https://supabase.com/dashboard/project/rgpfzactcqbvadthzsgx

Keys (stored in `index.html` for the anon key, and as function env vars for service role):

- **Anon key (public, in app):** `eyJhbGciOiJIUzI1NiIs...` (see `index.html`)
- **Service role key (server-only):** stored as Edge Function env var `SUPABASE_SERVICE_ROLE_KEY`

### GoHighLevel Per-Location API Keys (PITs)

> ⚠️ **Critical:** These are LOCATION-level Private Integration Tokens. Agency-level PITs will NOT work for these endpoints.

| Location  | GHL Location ID        | PIT Token                                  |
| --------- | ---------------------- | ------------------------------------------ |
| Fox Lake  | `ksTER6vcHvi08UdPCVxc` | `pit-539ec1d0-5ec9-4929-9fc7-ba318b39c61f` |
| Mishawaka | `dLfhsz6BpBB8Su1nqnuc` | `pit-afcea4c8-1536-4d13-9426-9b9447f1a7f8` |

Stored in `locations.ghl_api_key` column in Supabase.

### User Accounts (Seeded)

| Email                      | Role      | Access               | Password         |
| -------------------------- | --------- | -------------------- | ---------------- |
| mikebell@airafitness.com   | admin     | All locations        | `AiraAdmin2026!` |
| akathan24@gmail.com        | vp        | Fox Lake + Mishawaka | (set by user)    |
| jmcrago1003@gmail.com      | manager   | Fox Lake             | (set by user)    |
| jenny_davaalos@hotmail.com | sales_rep | Fox Lake             | (set by user)    |

### Supabase Schema (key tables)

All tables live in `public` and have RLS enabled.

| Table                                       | What it holds                                                                                                                                              | Who can read                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `locations`                                 | One row per gym: `ghl_location_id`, `name`, `ghl_api_key`, `ghl_calendar_id`, `pipeline_id`, `timezone`, `active`                                          | Admin: all; others: only linked locations                                       |
| `users`                                     | Portal users: `auth_user_id`, `email`, `full_name`, `role`, `ghl_user_id` (optional), `active`                                                             | Self + coworkers at shared locations; admin: all                                |
| `user_locations`                            | N-to-N between users and locations, with `is_primary` flag                                                                                                 | Self + admin                                                                    |
| `contacts`, `opportunities`, `appointments` | Cached mirror of GHL data                                                                                                                                  | Via `can_access_ghl_location()`                                                 |
| `appointments.portal_assigned_to`           | Rep attribution set at booking time; **sync never overwrites** it                                                                                          | —                                                                               |
| `pipeline_stages`                           | Stages discovered from GHL, with `counts_as_show / counts_as_no_show / counts_as_sale` flags                                                               | Via `can_access_ghl_location()`; admin writes via `pipeline_stages_admin_write` |
| `call_logs`                                 | "How'd it go?" outcomes logged per tap-to-call (`outcome`, `notes`, `user_id`)                                                                             | Location scope                                                                  |
| `sync_log`                                  | History of every sync attempt (status, type, started_at, completed_at, error_message, metadata.counts)                                                     | **Admin only**                                                                  |
| `ghl_staff`                                 | Cache of `GET /users/?locationId=X`, keyed `(ghl_location_id, ghl_user_id)` — powers admin "link existing GHL staff" dropdown                              | Via `can_access_ghl_location()`                                                 |
| `conversations`                             | Cache of `GET /conversations/search` + per-conversation `/messages` fetch, keyed by `ghl_conversation_id`. Last-30-days window; stores `full_thread` jsonb | Via `can_access_ghl_location()`                                                 |

### Deployed Edge Functions

All deployed with `--no-verify-jwt` (the gateway passes through; our functions verify JWT + role internally).

| Function                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                      | Caller requirements                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `sync-ghl-to-cache`           | Pulls GHL contacts/opps/appointments/staff into cache tables; auto-discovers pipelines for new locations                                                                                                                                                                                                                                                                                     | Any authenticated user _(not yet admin-gated — see Known Issues)_                      |
| `ghl-book-appointment`        | Creates a calendar event in GHL, upserts the cache with `portal_assigned_to` set, AND stamps `assignedTo` on any open opportunity for that contact at that location (if one exists) so the booking rep owns the lead going forward                                                                                                                                                           | User with `can_access_ghl_location(ghl_location_id)`                                   |
| `admin-create-location`       | Inserts a new `locations` row                                                                                                                                                                                                                                                                                                                                                                | Admin only (verified via `current_user_role()`)                                        |
| `admin-update-location`       | Updates a location; empty strings mean "keep existing" (never wipes `ghl_api_key`)                                                                                                                                                                                                                                                                                                           | Admin only                                                                             |
| `admin-invite-user`           | `auth.admin.inviteUserByEmail` (single call — creates auth user AND sends invite email) + `users` row + `user_locations`; full rollback on any downstream failure                                                                                                                                                                                                                            | Admin only                                                                             |
| `admin-update-user`           | Updates user scalars (with friendly 409 on duplicate `ghl_user_id` link) + replaces `user_locations`                                                                                                                                                                                                                                                                                         | Admin only                                                                             |
| `admin-delete-user`           | Removes a portal user: deletes `user_locations` + `call_logs`, NULLs `coaching_sessions.coach_user_id` (history preserved), deletes `public.users` row, deletes auth user. Refuses self-delete and last-remaining-admin delete                                                                                                                                                               | Admin only                                                                             |
| `ghl-update-opportunity`      | Updates an opportunity's `pipelineStageId` + optional `status` in GHL via `PUT /opportunities/:id`, AND auto-stamps `assignedTo` to the acting user (resolved via `ghl_staff` lookup at that location). Mirrors the change into `public.opportunities`. If no `ghl_staff` row matches the caller's email, stage change still succeeds and an onboarding-gap warning is written to `sync_log` | Admin / RD / VP / manager / sales_rep / franchisee with `can_access_ghl_location(...)` |
| `ghl-send-message`            | Sends an SMS / Email through GHL via `POST /conversations/messages`. Looks up the location's PIT, enforces location access on the caller                                                                                                                                                                                                                                                     | Admin / RD / VP / manager / sales_rep / franchisee with `can_access_ghl_location(...)` |
| `ghl-get-conversation-thread` | Lazy on-demand thread fetcher. Bulk sync caps thread hydration at 40 per location for budget reasons; tapping an older conversation triggers this function to pull `/conversations/:id/messages` and write it into `full_thread`                                                                                                                                                             | Admin / RD / VP / manager / sales_rep / franchisee with `can_access_ghl_location(...)` |
| `ghl-assign-opportunity`      | `PUT /opportunities/:id` with `assignedTo` only (no stage change). Caller's role gates who they can assign: managers/VPs/admins/franchisees can pick any `ghl_staff` row at the location; sales_rep can only assign to themselves. Mirrors `assigned_to` into `public.opportunities`                                                                                                         | Admin / RD / VP / manager / franchisee / sales_rep with `can_access_ghl_location(...)` |

---

## 8. THE AIRA BENCHMARKS THAT POWER THE PORTAL

Source: **Aira 5-Day Training v8**, page 35 — "Key Numbers Every Franchisee Must Know"

| Metric                         | Aira Target     | Portal Threshold (Red)             |
| ------------------------------ | --------------- | ---------------------------------- |
| Min ad spend / day             | $40             | N/A (informational)                |
| Target leads / day             | 8-10            | N/A                                |
| Lead → Appointment rate        | 50%+            | <50% = "Appointments broken"       |
| Show rate                      | 40-50%          | <40% = "Shows broken"              |
| **Close rate of shows**        | **70%+**        | **<70% = "Closing broken"**        |
| **ADPS (Avg Dollar Per Sale)** | **$220+**       | **<$220 = "Fees waived too fast"** |
| PIF attach rate                | 20% of sales    | —                                  |
| Attrition rate                 | ≤7%             | —                                  |
| CPL (Cost Per Lead)            | ≤$20            | —                                  |
| **Month 1 memberships**        | **40 sign-ups** | Floor is 30% lead-to-sale          |
| **Month 1 revenue**            | **$15,000+**    | —                                  |

### The Rule of 3 (Page 36 of Training)

> "If a gym is failing, it is always one of 3 things: **LEADS. APPOINTMENTS. CLOSING.** Diagnose which is broken. Fix THAT. Don't overhaul everything."

This is the single most important concept in the entire portal. Every diagnosis the Triage View produces will follow this order.

### Lead Sources (How we classify "ad leads")

**Counts as "ad lead" (subject to 30-60% floor):**

- Facebook Ad, Instagram Ad, Meta Ad
- Free Week Offer Claim, Keyfob funnel
- Landing page, Website form
- Google Ad, any lead form submit
- Any contact with an unclassified/null source (default-safe)

**Counts as "Extra Credit" (excluded from core math):**

- Comments on ads
- DMs / Direct Messages / Messages
- Organic social
- Walk-ins, referrals

Extra Credit is a BONUS — it can help underperformers close the gap, but doesn't reduce the expectation on ad lead conversion.

---

## 9. FILE STRUCTURE & KEY LOCATIONS

```
~/Downloads/operator-portal/            ← Local working directory
├── index.html                          ← The entire app (HTML + React + CSS inline)
├── manifest.json                       ← PWA manifest
├── icon-192.png, icon-512.png          ← App icons
├── supabase/
│   ├── functions/
│   │   └── sync-ghl-to-cache/
│   │       └── index.ts                ← Edge Function that pulls GHL data
│   ├── migrations/                     ← SQL migrations
│   └── .temp/, .env                    ← (gitignored)
├── .gitignore
└── README.md
```

**The entire React app lives in `index.html`.** This is intentional — no build step, no npm install, no webpack. Deploy is literally `git push`.

---

## 10. TERMINAL COMMANDS YOU'LL USE

All commands assume you're in `~/Downloads/operator-portal`:

```bash
cd ~/Downloads/operator-portal
```

### Daily Use

**Open the portal locally (with uncommitted changes):**

```bash
open ~/Downloads/operator-portal/index.html
```

**Open the live portal:**

```bash
open https://airafitnessfranchise.github.io/operator-portal/
```

**Check git status:**

```bash
git status
```

**Pull latest changes from remote:**

```bash
git pull origin main
```

**Commit and push your changes:**

```bash
git add .
git commit -m "Your commit message here"
git push origin main
```

### Supabase Edge Function

**Deploy the GHL sync function after editing:**

```bash
supabase functions deploy sync-ghl-to-cache --no-verify-jwt --project-ref rgpfzactcqbvadthzsgx
```

**Trigger a sync for ALL locations:**

```bash
curl -sS -X POST https://rgpfzactcqbvadthzsgx.supabase.co/functions/v1/sync-ghl-to-cache \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJncGZ6YWN0Y3FidmFkdGh6c2d4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NzU2NTQsImV4cCI6MjA5MjA1MTY1NH0.rbiSxQfzVU_pvF9X8BN2jGU_pBdcwJRN_n00pivAc1w" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Trigger a sync for ONE location (replace the ID):**

```bash
curl -sS -X POST https://rgpfzactcqbvadthzsgx.supabase.co/functions/v1/sync-ghl-to-cache \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"ghl_location_id":"dLfhsz6BpBB8Su1nqnuc"}'
```

### Claude Code

**Start a Claude Code session in the project:**

```bash
cd ~/Downloads/operator-portal
claude
```

Then paste any of the build briefs from this document or your conversation with Claude in the browser.

---

## 11. TROUBLESHOOTING & KNOWN ISSUES

### Known Issues (deferred, not blocking)

| Issue                                                                        | Impact                                                                                 | Workaround / Fix                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync-ghl-to-cache` accepts any authenticated JWT — not admin-gated          | Any signed-in user can trigger a sync (idempotent, rate-limited by GHL)                | Low risk; tighten with the same `current_user_role()` gate the other admin-\* functions use when convenient                                                                            |
| Ad Spend hardcoded as "—"                                                    | Single-location + territory dashboards show placeholder                                | Waiting on a decision: Facebook Ad Manager API vs. manual weekly entry                                                                                                                 |
| Two API keys were pasted in chat history during development                  | Minor security footprint                                                               | Rotate when convenient; both are location-scoped (limited blast radius)                                                                                                                |
| Historical Fox Lake opportunities still have `assigned_to = null`            | Rep dashboards won't backfill for pre-portal bookings                                  | Going forward is fine — `portal_assigned_to` is set at booking time and `coalesce(portal_assigned_to, assigned_to)` drives rep KPIs. Separate Jasmine-led cleanup for historical rows. |
| Invite flow's `SetPasswordScreen` not yet tested with expired-link edge case | Users who click an invite link >24h later may land on a generic login with no guidance | Test the expired path, confirm the "Ask your admin to resend" gate renders                                                                                                             |
| New behavior: every portal stage-change sets `assignedTo` in GHL             | Needs live verification with Alyssa's account on Fox Lake                              | Ship, test with one lead end-to-end; delete this row once confirmed round-trip                                                                                                         |

### Backlog

| Item                       | Why it matters                                                                                                                             | When to do it                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Stage-flag drift detection | If a franchisee renames a GHL stage, portal auto-discovery re-applies heuristic flags on next sync — could silently break Triage diagnosis | Add a `sync_log` warning when stage names change unexpectedly |

### Common Problems

**"I see zeros on the dashboard after logging in":**

- Browser may have cached old HTML. Hard refresh: `Cmd+Shift+R`
- If still zero, the cache hasn't been populated. Trigger a sync (see commands above).

**"Sync function returns an error about pipeline_id":**

- The location likely doesn't have a `pipeline_id` in the DB. The sync should auto-discover it, but if that fails, it means GHL returned no pipelines for that location. Check that the PIT has the right scopes.

**"GitHub Pages isn't showing my latest push":**

- Can take 30-60 seconds after push. Check the Actions tab on GitHub for deploy status.
- Sometimes browser caches the old version. Try incognito mode.

**"I can't log in — password incorrect":**

- Passwords for franchisee accounts need to be set by them on first login (via Supabase magic link, although we don't use magic links for operators yet — TBD flow).
- Mike's admin password is set directly in the auth.users table. See section 7.

---

## 12. ROADMAP

**Priority ordered. Each = roughly one focused build session with Claude Code.** Items 1–4 from the previous version (Multi-location + Territory, VP Triage, personal rep dashboards, admin onboarding) are shipped and now live in Section 4.

| #   | Feature                                           | Value Delivered                                                               | Status  |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| 1   | Coaching Action Tracker (Phase 10)                | Coaching stops disappearing into DMs; every red diagnosis has an owned action | Planned |
| 2   | Accountability Loop (Phase 11)                    | VPs can measure their own impact — did the coaching move the metric?          | Planned |
| 3   | Lock `sync-ghl-to-cache` to admin / cron only     | Tightens the single Edge Function that still accepts any authenticated JWT    | Planned |
| 4   | Wire Leads screen to real GHL data                | Jasmine sees real leads on her phone (replaces seeded demo rows)              | ✅ Done |
| 5   | Wire Conversations screen to real data + SMS send | Reply to SMS from the portal                                                  | ✅ Done |
| 6   | Facebook Ad Spend integration                     | ADPS calculations include ad-spend data; removes "—" placeholder              | Planned |
| 7   | Custom domain `portal.airafitness.com`            | Professional URL for franchisees                                              | Planned |
| 8   | Onboard next 3 locations                          | Exercise the location-add workflow built in Phase 9A                          | Planned |
| 9   | Multi-location rollout to all 22+ gyms            | Replace the GHL white-label app entirely                                      | Planned |

---

## 13. HOW TO ONBOARD A NEW LOCATION

This is the playbook for when Aira opens gym #3, #4, #22.

### Step 1: Get the GHL Info

From the new location's sub-account in GoHighLevel:

1. Copy the **Location ID** (usually a 20-character alphanumeric string)
2. Create a **Location-Level Private Integration Token** (Settings → Private Integrations → New Token)
3. Give it scopes: contacts.readonly, opportunities.readonly, conversations.readonly, calendars.readonly (and any write scopes you want later)
4. Copy the PIT (starts with `pit-...`)

### Step 2: Add the Location to Supabase

Run this SQL in the Supabase SQL Editor:

```sql
insert into public.locations (
  ghl_location_id,
  name,
  active,
  ghl_api_key,
  timezone
) values (
  'NEW_LOCATION_ID_HERE',
  'Aira Fitness [CITY NAME]',
  true,
  'pit-NEW_TOKEN_HERE',
  'America/Chicago'  -- adjust for location's timezone
);
```

### Step 3: Trigger the Sync

```bash
curl -sS -X POST https://rgpfzactcqbvadthzsgx.supabase.co/functions/v1/sync-ghl-to-cache \
  -H "Authorization: Bearer [ANON_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"ghl_location_id":"NEW_LOCATION_ID_HERE"}'
```

The Edge Function will:

- Pull all contacts and opportunities
- Auto-discover the pipeline and its stages
- Apply heuristic flags to stages (Sold = sale, No Show = no show, etc.)
- Populate the cache

### Step 4: Verify the Stage Flags

Auto-discovery is good but not perfect. In Supabase, check `pipeline_stages` for this location and manually correct any flags that are wrong. For example, if a stage called "Signed Up" was missed as a sale, update `counts_as_sale = true`.

### Step 5: Assign the Franchisee + Manager to the Location

```sql
-- Add a manager for the location
insert into public.users (auth_user_id, email, full_name, role, active)
values ('[auth uuid]', 'manager@email.com', 'Manager Name', 'manager', true);

-- Link them to the location
insert into public.user_locations (user_id, location_id, is_primary)
select u.id, l.id, true
from public.users u
cross join public.locations l
where u.email = 'manager@email.com'
  and l.ghl_location_id = 'NEW_LOCATION_ID_HERE';
```

### Step 6: (Optional) Assign a VP to Include This Location in Their Territory

```sql
insert into public.user_locations (user_id, location_id, is_primary)
select u.id, l.id, false
from public.users u
cross join public.locations l
where u.email = 'vp@airafitness.com'
  and l.ghl_location_id = 'NEW_LOCATION_ID_HERE';
```

Done. The new location now shows up in the VP's territory dashboard and (soon) triage view.

---

## APPENDIX: KEY DECISIONS LOG

This section captures the strategic calls we've made so future decisions inherit the context.

**April 18, 2026 — Strategic direction: "Management tool, not replacement."**
Mike chose the VP-weapon path (Answer 2) over replacing GHL (Answer 1) or building full Aira OS (Answer 3). The reasoning: Alyssa is a real operator who knows how to coach; give her the data and she'll lift underperformers immediately.

**April 18, 2026 — Lead-to-sale floor is the real metric.**
Mike reframed: 40 memberships/mo is a floor, not a goal. The real benchmark is 30-60% of ad leads becoming sales. This changes every diagnosis and every dollar-on-the-table calculation.

**April 18, 2026 — Extra Credit doesn't count toward the math.**
Organic comments, DMs, walk-ins are a bonus that can help underperformers close the gap, but the 30% floor applies only to ad leads. This prevents franchisees from padding their numbers with easy wins while hiding paid-lead conversion problems.

**April 18, 2026 — Rule of 3 governs diagnosis order.**
When multiple funnel steps are broken, always surface the earliest one (Appointments before Shows before Closing). Fixing closing when appointments are broken is meaningless.

**April 18, 2026 — Per-location API keys, not global.**
Each gym's PIT is stored in `locations.ghl_api_key`. Agency-level PITs don't have access to sub-account endpoints, and this pattern scales cleanly to 22+ locations.

**April 18, 2026 — No magic links for operator auth.**
Email + password only. Magic links create friction on phones; operators need to be able to log in fast and stay logged in.

**April 18, 2026 — Architecture locked: portal is the source of truth; GHL stays infrastructure.**
No human user of the Aira portal should ever need to open GoHighLevel. Operators see the portal, period — GHL is plumbing. Practical consequences: `portal_assigned_to` drives rep attribution even when GHL doesn't populate `assignedUserId`; booking / status writes flow portal → GHL one-way; and admin onboarding never asks operators to touch GHL to create an account.

**April 18, 2026 — Portal-only user architecture (Phase 9B).**
`public.users.ghl_user_id = null` is a fully supported, first-class state. A portal user doesn't need a GHL account to exist, be tracked, or have their work attributed. The UI shows a neutral "Portal-only" pill — not a warning. Admins can optionally link a user to an existing `ghl_staff` row later, but are never required to. This unblocks hiring reps without any GHL IT step.

**April 20, 2026 — Invite flow uses `inviteUserByEmail`, not `createUser` + `generateLink`.**
The earlier `admin-invite-user` pattern silently created auth users but never triggered Supabase's mail pipeline — `mail.send` only fires when the `/invite` endpoint is used. Switched to `auth.admin.inviteUserByEmail(email, { data, redirectTo })` as the single source of invite truth. Every future operator invite flows through this single function.

**April 20, 2026 — Portal handles invite + recovery URL hashes natively.**
Supabase delivers invite sessions via URL hash (`#access_token=...&type=invite`). The portal now detects this on mount, establishes the session, and forces `SetPasswordScreen` before the user can proceed. Clicking an invite email no longer dumps users on a generic login screen expecting a password they never set.

**April 20, 2026 — Coaching session records survive user deletion.**
When a user is removed from the portal, their `coaching_sessions.coach_user_id` is set to NULL (not cascade-deleted). Coaching history is the portal's honesty mechanism (per April 18 decision) — deleting a VP's track record when they offboard would create a backdoor around that honesty. Preserved sessions with a NULL coach still surface in historical reporting; attribution can be re-stamped if the user is re-invited.

**April 20, 2026 — Bottom-nav scoping follows the view, not the user.**
Decision: when a multi-location VP is in Territory/Triage view, bottom nav shows aggregated "All Leads" / "All Messages" across their accessible locations, with 📍 tags identifying origin. When drilled into a specific gym, nav scopes to that gym. Single-location users always see their single location. Reasoning: a VP's first instinct is "what needs me right now across everything" — aggregation matches that intent. Scoping kicks in the moment they pick a specific gym to focus on.

**April 20, 2026 — Portal stage changes auto-assign the acting user in GHL.**
Going forward, any portal user who marks an opportunity as Booked or Sold is automatically stamped as the assigned rep in GHL via `ghl-update-opportunity` and `ghl-book-appointment`. Attribution happens at the point of action, not as a separate data-entry step. Historical opportunities remain unassigned (not retro-attributing). Reasoning: franchisees don't need to remember — the system enforces it. This is how the portal becomes the source of truth for rep performance, not just a viewer of GHL. A new standalone `ghl-assign-opportunity` function supports manual reassignment (e.g. a franchisee claiming ownership of an existing lead); sales_rep role is self-only, managers/VPs/admins/franchisees can reassign to anyone in that location's `ghl_staff`.

---

_End of reference document. Keep this file updated as the portal evolves — it's the single source of truth for what's real, what's planned, and why._
