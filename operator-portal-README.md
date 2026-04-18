# Aira Fitness — Operator Portal

Mobile-first franchisee operations dashboard for Aira Fitness locations.

## Features

- **Dashboard** — KPIs, monthly targets, rep leaderboard
- **Leads** — Full lead list with status filters, tap-to-call, tap-to-text
- **Conversations** — SMS inbox with unread badges
- **Appointments** — Daily schedule with quick-action buttons
- **PWA** — Add to home screen for app-like experience

## Setup

1. Deploy to GitHub Pages
2. Point `portal.airafitness.com` CNAME to `airafitnessfranchise.github.io`
3. Configure GHL API key for live data (Phase 2)

## Architecture

- Static HTML/CSS/JS — no build step
- React 18 via CDN
- GHL REST API for live data (Phase 2)
- `tel:` links for native phone dialer integration
- `sms:` links for native messaging integration

## Phase 2 Roadmap

- [ ] Live GHL API integration (contacts, opportunities, conversations)
- [ ] Send SMS through GHL API
- [ ] Pipeline stage updates via API
- [ ] Multi-location selector
- [ ] Rep login / auth
