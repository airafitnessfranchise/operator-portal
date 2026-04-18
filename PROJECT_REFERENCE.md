# Aira Operator Portal — Project Reference

**Last updated:** April 18, 2026
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

| Feature | Status | Notes |
|---|---|---|
| PWA shell (HTML, React CDN, Babel) | ✅ Live | No build step. Single `index.html`. |
| Mobile-first design (Aira branded) | ✅ Live | Dark theme, DM Sans + Outfit fonts |
| Supabase authentication (email+password) | ✅ Live | No magic links — Mike's decision |
| Role-based access (admin, vp, rd, franchisee, manager, sales_rep) | ✅ Live | RLS enforced at DB level |
| Multi-location user access | ✅ Live | `user_locations` join table |
| Single-location dashboard with real KPIs | ✅ Live | Pulled from Supabase cache |
| Territory Dashboard (multi-location summary) | ✅ Live | Default view for VP/admin users |
| Back-to-territory navigation | ✅ Live | Chip below header in location view |
| Per-location API credentials | ✅ Live | Each location has own PIT stored in DB |
| Auto-discovery of pipelines + stage flags | ✅ Live | Via heuristic on stage names |
| GHL-to-Supabase sync (Edge Function) | ✅ Live | On-demand; caches contacts, opps, appts |
| GitHub Pages deployment | ✅ Live | Auto-deploys on push to `main` |
| Settings drawer with logout | ✅ Live | Leaderboard hidden for sales_rep role |

### Locations Configured

- **Aira Fitness Fox Lake** (pilot) — fully synced
- **Aira Fitness Mishawaka** — fully synced, auto-discovered pipeline

---

## 5. WHAT WE'RE BUILDING NEXT

### Phase 7: The VP Triage View 🔨 IN PROGRESS

**Goal:** Turn the Territory Dashboard into a weapon by surfacing which locations are bleeding money, exactly why, and how much.

**The Core Insight (Mike's Reframe, April 18, 2026):**
> The 40-memberships/month target is a FLOOR. The real measure is **lead-to-sale conversion**. A location with 200 ad leads and 10 sales isn't "behind target" — it's leaving **$20,950 on the table** because Aira franchisees should convert at minimum 30% of ad leads to sales, maximum 60%.

**The Math:**
- **Floor:** 30% of ad leads → sales
- **Ceiling:** 60% of ad leads → sales
- **Dollars left on table** = (ad leads × 0.30 − actual sales) × $419
- (Where $419 = $220 ADPS + 0.20 PIF attach rate × $997)

**Real April 2026 data through this lens:**
| Location | Ad Leads | Actual Sales | Floor | Ceiling | Money on Table (Floor) | Upside (Ceiling) |
|---|---|---|---|---|---|---|
| Fox Lake | 63 | 4 | 18 | 37 | **$5,866** | $13,827 |
| Mishawaka | 200 | 10 | 60 | 120 | **$20,950** | $46,090 |

**Status Colors:**
- 🔴 Red: below 30% floor (money bleeding)
- 🟡 Yellow: 30-45% (hitting floor, not running the system well)
- 🟢 Green: 45%+ (running the Aira way)

**Diagnosis Uses Rule of 3:**
When a location is red, surface the EARLIEST broken step in the funnel (never more than one diagnosis per card):
1. Lead → Appointment rate <50% → "Appointments broken."
2. Show rate <40% → "Shows broken."
3. Close rate of shows <70% → "Closing broken."
4. ADPS <$220 → "Fees waived too fast."

**What Alyssa Sees Tomorrow (once shipped):**
> 🔴 **2 locations need attention today · $26,816 on the table**
>
> 🔴 **Mishawaka** — $20,950 on the table. *Closing broken. 11% close rate on shows.*
> 🔴 **Fox Lake** — $5,866 on the table. *Closing broken. 18% close rate on shows.*

### Phase 8 (After Phase 7): Coaching Action Tracker

When Alyssa opens a red location, she logs what action she took ("Called Jasmine, coached on Deaf Ear close, sending bootcamp script Monday"). Timestamped, searchable. Gives the org a memory of coaching.

### Phase 9 (After Phase 8): Accountability Loop

A week after Alyssa logs an action, the portal tells her whether it worked ("You coached Jasmine on close rate April 18. Close rate since: 18% → 34%. Action worked."). This forces measurement of the VP layer itself.

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
│ • Auth: email/password                      │
│ • Postgres: locations, users, contacts,     │
│   opportunities, appointments, pipelines    │
│ • RLS policies enforce role + location      │
│ • RPCs: dashboard_kpis, territory_kpis,     │
│   rep_leaderboard, location_triage (soon)   │
│ • Edge Function: sync-ghl-to-cache          │
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

| Location | GHL Location ID | PIT Token |
|---|---|---|
| Fox Lake | `ksTER6vcHvi08UdPCVxc` | `pit-539ec1d0-5ec9-4929-9fc7-ba318b39c61f` |
| Mishawaka | `dLfhsz6BpBB8Su1nqnuc` | `pit-afcea4c8-1536-4d13-9426-9b9447f1a7f8` |

Stored in `locations.ghl_api_key` column in Supabase.

### User Accounts (Seeded)

| Email | Role | Access | Password |
|---|---|---|---|
| mikebell@airafitness.com | admin | All locations | `AiraAdmin2026!` |
| akathan24@gmail.com | vp | Fox Lake + Mishawaka | (set by user) |
| jmcrago1003@gmail.com | manager | Fox Lake | (set by user) |
| jenny_davaalos@hotmail.com | sales_rep | Fox Lake | (set by user) |

---

## 8. THE AIRA BENCHMARKS THAT POWER THE PORTAL

Source: **Aira 5-Day Training v8**, page 35 — "Key Numbers Every Franchisee Must Know"

| Metric | Aira Target | Portal Threshold (Red) |
|---|---|---|
| Min ad spend / day | $40 | N/A (informational) |
| Target leads / day | 8-10 | N/A |
| Lead → Appointment rate | 50%+ | <50% = "Appointments broken" |
| Show rate | 40-50% | <40% = "Shows broken" |
| **Close rate of shows** | **70%+** | **<70% = "Closing broken"** |
| **ADPS (Avg Dollar Per Sale)** | **$220+** | **<$220 = "Fees waived too fast"** |
| PIF attach rate | 20% of sales | — |
| Attrition rate | ≤7% | — |
| CPL (Cost Per Lead) | ≤$20 | — |
| **Month 1 memberships** | **40 sign-ups** | Floor is 30% lead-to-sale |
| **Month 1 revenue** | **$15,000+** | — |

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

| Issue | Impact | Workaround / Fix |
|---|---|---|
| Fox Lake calendar returns 0 events | Appointments screen shows empty for Fox Lake | Need to identify correct calendar ID with Jasmine. Mishawaka doesn't have a calendar ID configured yet either. |
| All opportunities have `assigned_to: null` in Fox Lake | Rep leaderboard shows zeros | Process conversation needed with Jasmine — reps aren't being tagged in GHL |
| Ad Spend hardcoded as "—" | Dashboard shows placeholder | Waiting to decide how to source Facebook Ad Manager data. API or manual weekly entry? |
| Leads / Conversations / Appointments screens still use demo data | Operators see fake leads | Wire to real data after Phase 7 ships |
| Two API keys have been shared in chat history | Minor security risk | Rotate when convenient; both are location-scoped (limited blast radius) |

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

**Priority ordered. Each = roughly one focused build session with Claude Code.**

| # | Feature | Value Delivered |
|---|---|---|
| 1 | ✅ Multi-location + Territory Dashboard | VPs see territory at a glance |
| 2 | 🔨 VP Triage View (Phase 7) | Alyssa opens the app and knows who to coach |
| 3 | Coaching Action Tracker (Phase 8) | Coaching stops disappearing into DMs |
| 4 | Accountability Loop (Phase 9) | VPs can measure their own impact |
| 5 | Wire Leads screen to real GHL data | Jasmine sees real leads on her phone |
| 6 | Wire Conversations screen to real data | Reply to SMS from the portal |
| 7 | Fix Fox Lake calendar mapping | Appointments screen becomes useful |
| 8 | Facebook Ad Spend integration | ADPS calculations include ad spend data |
| 9 | Custom domain portal.airafitness.com | Professional URL for franchisees |
| 10 | Onboard next 3 locations | Test the location-adding workflow |
| 11 | Rep-level login scoping | Jenny sees only her assigned leads |
| 12 | Call logging ("How'd it go?" prompt) | Auto-update lead status after calls |
| 13 | Multi-location rollout to all 22+ gyms | Replace GHL white-label app entirely |

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

---

*End of reference document. Keep this file updated as the portal evolves — it's the single source of truth for what's real, what's planned, and why.*
