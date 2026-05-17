# Eazo Hackathon 2026 · Engineering Handoff

**To:** Eazo Product & Engineering Team
**From:** Hackathon Operations
**Re:** Voting & Scoring System — Integration Requirements
**Last updated:** 2026-05-16

---

## What We've Built

A full voting + scoring system for the Global Hackathon. Runs as a separate web service that sits on top of Eazo's existing platform.

| Page | URL | Who uses it |
|------|-----|-------------|
| Community Vote | `/vote` | All event attendees — WebView in Eazo app |
| Peer Vote (互评) | `/peer-vote` | Participating teams only — WebView in Eazo app |
| Live Leaderboard | `/onair` | Ops/host team — projected on screen |
| Judge Scorer | `/judge?hub=sf&code=JUDGE_SF_01` | Judges — link sent via messaging app |
| Finalist Announcement | `/finalist?hub=sf` | MC/host — projected on screen |

The system has its own database (Supabase/Postgres). **We do not touch Eazo's database directly.** Everything flows through the integration points described below.

---

## ✅ Resolved Since Last Version

Thank you for sending `hackathon-api.md` (v1.2) and the judge guide. Items previously listed as "pending" are now resolved:

| Previously needed | Status | Notes |
|---|---|---|
| Judge scoring rubric (was TBD) | ✅ Resolved | Using the 5-criterion rubric from the Judge Guide (Completeness / Innovation / Technical / Design / Commercial; 10 pts each, 50 total). Schema, API, UI, and migration SQL all updated. |
| Team **roster** source | ✅ Resolved (interim) | `api/sync-teams.js` reads the Tally registration sheet (`1W7V…`) by column index for team_name / region / track / roster. The sheet **does not and will not** carry project details (title / URL / cover / description). |
| Project **details** source | 🟡 Architectural alignment | Project details live in Eazo Creator (`creator_apps.*`), not in Tally. Eazo's portal endpoint `GET /api/v1/hackathon/apps` is the bridge — it joins sheet email → Eazo `users.email` → `creator_apps` and returns the merged record. We consume that endpoint when it goes live. Until then, the project_name / project_desc / appUrl fields stay empty (the detail-view "Open App" button shows "coming soon"). |
| Hub / region structure | ✅ Resolved | Frontend pages (comm-vote, peer-vote, onair) display **3 prize-pool regions per prize-logic-v4**: SF = SF Bay Area + Global Online · NY = standalone · SH = Shanghai + Asia Online. Backend `teams.hub` keeps the 5-hub enum for now (sf/ny/sh/go/ao) so we still know who's offline vs online in finalist buckets. |
| CN-only IP gating | ✅ Resolved | Dropped — all regions visible everywhere. `api/detect-hub.js` is now just a default-selection hint. |
| Composite weighting | ✅ Resolved | 50% public vote / 40% judge / 10% peer, per the Judge Guide. |
| Peer-vote rules | ✅ Resolved | 3 votes per person, no self-vote, auto-lock at deadline, vote-once (no edits). Already correctly implemented in `api/peer-vote.js`; frontend now matches with detail modal parity to comm-vote. |
| Project detail view | ✅ Resolved | Tap any project card in comm-vote or peer-vote → full-screen detail modal showing project info, track, "Open App →" button (when team has shared a URL), and vote/select CTA. Designed for the Eazo mobile-app WebView context. |

---

## What We Still Need From You

Only **two open items** remain. Both are short.

---

### 1. User Auth Token (for the WebViews)

**Status:** Still required. `hackathon-api.md` declares the read API public, but **our voting endpoints** need to know *who* is voting in order to enforce per-user vote budgets and prevent double voting. The browse API being public doesn't change that.

**How the WebView bridge works (our side):** We listen for a global variable injection:

```js
// Option A: inject before load
window.EAZO_TOKEN = "...";
// Option B: call after load
window.receiveAuthToken("...");
// Option C: postMessage — we'll listen for {type:'eazo_token', token:'...'}
```

**What the token must contain** (after we decode/verify it):
- `user_id` — unique, stable user identifier (vote-budget key)
- `team_id` — the user's team identifier (for peer vote, to exclude their own team)
- `region` — `new_york` / `asia` / `global` (so we auto-select the right tab; also reliably tells us their country without an IP lookup)

**What we need from you:**
1. **Token format** — JWT (RS256/HS256/ES256)? Or a different format?
2. **Verification key** — public key or shared secret so we can validate it server-side
3. **Payload field names** — actual field names for the three values above (is it `sub`, `userId`, `user_id`?)
4. **Injection method** — which of A/B/C above does the Eazo app already do?

> **Simplest MVP path:** if you don't have a signed-token bridge yet, inject `window.EAZO_USER = { userId, teamId, region }` as a plain JS object before the WebView loads. No crypto needed — we add signature verification later.

---

### 2. Portal Endpoint & Deployment Status (`GET /api/v1/hackathon/apps`)

**This is the load-bearing piece.** It's how project info reaches our voting pages. Without it, the comm-vote and peer-vote detail pages can show team names + tracks but **cannot show the actual app or link to it.** The Tally sheet only has registration data; the project itself lives in Eazo Creator (`creator_apps`). Your portal does the email-based join and returns the merged record — we consume that one endpoint and we're good.

**What we need from you:**
1. **Portal base URL** — what's `$PORTAL` in your spec examples? (e.g. `https://api.eazo.com`)
2. **Expected deployment date** — so we know when to swap our data source from "registration-only" to "registration + project."
3. **Heads-up on the `sortBy=votes` user story** — note that "votes" in your spec maps to `creator_apps.like_num`, not hackathon community votes. **Our hackathon votes live in our Supabase**, not in your portal. We will **not** consume `sortBy=votes` from your endpoint — our own vote rankings stay authoritative. (Flagging this so the Eazo dev team doesn't build something we won't use.)
4. **Confirm the no-match policy** — when a sheet row's `Eazo Creator registration email` doesn't match any Eazo user yet (e.g. team registered but hasn't installed the app or built anything), does your endpoint return the team with `creatorApp: null`, or omit them entirely? We need to know whether to show "registered, no app yet" rows or filter them out.

---

## What You Don't Need to Do

Fully handled on our side:

- ✅ All vote storage, deduplication, and per-user budget enforcement
- ✅ Peer vote rules (3 votes, no self-vote, once only)
- ✅ Finalist calculation logic and demo-slot allocation
- ✅ Judge scoring interface and 5-criterion rubric
- ✅ Live leaderboard (OnAir)
- ✅ All frontend pages
- ✅ Database schema + migrations
- ✅ Direct ingestion of the Tally → Google Sheet submission data

---

## Deployment Configuration

We deploy to **Vercel**. Required environment variables once you confirm the items above:

```bash
# Resolved (in place)
EAZO_SHEETS_API_KEY=AIzaSy...           # Google Sheets API key for the submission sheet
EAZO_SHEET_ID=1muwuDscQpacD1Ifbzsl0jwBj16-_HQPHPXRB5Zl1HC4
SUPABASE_URL=https://...                 # our Supabase
SUPABASE_SERVICE_ROLE_KEY=...

# Still pending (Item 1 + 2 above)
EAZO_JWT_SECRET=...                      # token verification key
EAZO_PORTAL_BASE=https://api.eazo.com    # optional — once portal is deployed, we'll swap from direct sheet to portal
```

> **API key handling reminder:** the Sheets API key you shared was passed in plaintext over chat. Please rotate it and apply restrictions (Sheets API only, HTTP referrer = our Vercel domain) per [Google's key best-practices doc](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices). Send the new key via a secure channel (1Password share, Vercel env vars dashboard, etc.).

---

## Timeline Sensitivity

| Item | Needed by | Why |
|------|-----------|-----|
| Auth token spec (Item 1) | ASAP | Community vote and peer vote can't go live without it |
| Portal endpoint URL (Item 2) | Optional — interim path works | Lets us pick up `creatorApp` enrichment when ready |
| Restricted API key (rotation) | Before go-live | Current key is exposed in chat history |

---

## Architecture at a Glance

```
Eazo Mobile App                       Tally form → our gsheet (1W7V…)
─────────────────                     ─────────────────────────────────
Team forms                            Registration submitted
↓                                     ↓
Team builds app on Eazo Creator       Team roster + region + track
↓                                     ↓
(creator_apps.*)                      (no project details — by design)
        │                                            │
        └──────────────┬─────────────────────────────┘
                       ↓
         Eazo portal joins by email
         GET /api/v1/hackathon/apps
                       ↓
         Our Supabase ← → Our voting pages
```

The cross-check ("is this Eazo Creator app actually a hackathon project?") happens at **email-match time** in the portal. We don't reproduce that logic — we just consume the answer.

---

## Data Model (after migrations 003-006)

A team can submit **multiple apps**. Voting / scoring is per-app; qualification thresholds are per-app; finalist slots are per-team (one Demo slot per team regardless of how many of their apps qualified).

| Concept | Aggregation |
|---|---|
| Team's community-vote score (V) | `MAX(votes)` across team's apps |
| Team's peer-vote score (P) | `MAX(peer_votes)` across team's apps |
| Team's judge score (J) | `AVG(total)` across team's judged apps |
| Demo finalist | Team enters with their best-app score in each bucket |
| Special Award (B-class $1000) | Any team where best app > 200 community votes AND not in Demo |
| User vote budget | 10 votes per **PRIZE-POOL REGION** (sf+go share one, sh+ao share one, ny standalone) |

## Code Pointers

Codebase: `github.com/kristywhim/eazo-2026-hackathon`

| Concern | File |
|---|---|
| Canonical deadlines (single source of truth) | `api/_deadlines.js` + public `GET /api/deadlines` |
| Eazo portal naming bridge (stub) | `api/_eazo_portal_mapping.js` |
| Sheets ingestion (interim) | `api/sync-teams.js` (creates 1 placeholder app per team) |
| Seed mock teams (dry-run) | `POST /api/seed-mock-teams?secret=...` |
| Seed mock apps (multi-app demo) | `POST /api/seed-mock-apps?secret=...` |
| Auth token verification (Item 1, still pending) | `api/_auth.js` |
| Community vote (per-app, per-region budget) | `api/vote.js` |
| Peer vote (per-app, region-merged) | `api/peer-vote.js` |
| Projects listing (3-region merged at backend) | `api/projects.js` (`?region=sf\|ny\|sh`) |
| Leaderboard (app-level ranking) | `api/leaderboard.js` |
| Judge rubric (per-app scoring, 5 criteria × 10 pts) | `api/judge-score.js`, `eazo-judgescorer/index.html` |
| Award ranking (composite V·50% + J·40% + P·10%) | `api/award-ranking.js`, `eazo-finalist/index.html` |
| Special Award candidates | `api/special-awards.js`, `eazo-finalist/index.html` |
| Schema (current) | `supabase/schema.sql` |
| Migrations (run in order) | `supabase/migrations/001..006` |
| Reference materials | `_reference/hackathon-api.md`, `_reference/eazo_2026_judge_guide_en.md`, `_reference/prize-logic-v4.html`, `_reference/1778987515256.jpg` (deadlines) |

## Migrations to Run in Supabase (in order)

If you've already run `001`, run these next:

1. `003_online_qualification_fix.sql` — corrects C/D online qualification (V·50% + P·10% standardized, not just V)
2. `004_region_budget.sql` — adds `user_region_budget` (10 votes / prize-pool region)
3. `005_apps_table.sql` — adds `apps` table + new views; migrates each existing team into 1 placeholder app
4. `006_calculate_finalists_app_dimension.sql` — rewrites `calculate_finalists` to rank apps then dedup by team

All are wrapped in `BEGIN/COMMIT`, so any failure rolls back cleanly.

---

## Still On Our Side To Do (post-handoff)

So you can see what's coming from our side without waiting on Eazo:

- Finalist admin dashboard: rebuild as a 3-region view with A/B/C-D buckets per `prize-logic-v4`.
- OnAir leaderboard: collapse 5 boards → 3 regions.
- `calculate_finalists` Postgres function: drop the `referral_count > 200` constraint from the peer-vote bucket (peer top-N is the rule per prize-logic; the >200 threshold belongs to the *Special Award* B-class, which is a separate track).
- Wire the remaining frontends (comm-vote, peer-vote, onair, finalist) to live API endpoints after the regions and finalist work settle.
