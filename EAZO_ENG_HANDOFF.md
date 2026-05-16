# Eazo Hackathon 2026 · Engineering Handoff

**To:** Eazo Product & Engineering Team  
**From:** Hackathon Operations  
**Re:** Voting & Scoring System — Integration Requirements  
**Date:** May 2026

---

## What We've Built

We've built and deployed a full voting + scoring system for the Global Hackathon. It runs as a separate web service that sits on top of Eazo's existing platform. Here's what exists:

| Page | URL | Who uses it |
|------|-----|-------------|
| Community Vote | `/vote` | All event attendees — WebView in Eazo app |
| Peer Vote (互评) | `/peer-vote` | Participating teams only — WebView in Eazo app |
| Live Leaderboard | `/onair` | Ops/host team — projected on screen |
| Judge Scorer | `/judge?hub=sf&code=JUDGE_SF_01` | Judges — link sent via messaging app |
| Finalist Announcement | `/finalist?hub=sf` | MC/host — projected on screen |

The system has its own database (Supabase/Postgres). **We do not touch Eazo's database directly.** Everything flows through the three integration points described below.

---

## What We Need From You

There are exactly **three things** we need. Nothing else is blocking us.

---

### 1. Team Data API

**What it is:** An endpoint that returns the list of registered hackathon teams with their project info.

**When we call it:** Once after registration closes, then again if data changes. We sync it into our database with `POST /api/sync-teams`.

**What we need the response to include, per team:**

```json
{
  "team_id": "string — your internal team identifier",
  "team_name": "string",
  "project_name": "string",
  "project_desc": "string (optional)",
  "hub": "sf | ny | sh | go | ao",
  "track": "superparent | companion | lifeos | body | wildcard",
  "referral_count": 320,
  "submitted_at": "2026-05-23T18:30:00Z"
}
```

**Fields we can adapt to:** If your field names are different (e.g. `location` instead of `hub`, `category` instead of `track`), just tell us the actual names — we have a mapping layer ready.

**What we also need from you:**
- The endpoint URL (e.g. `https://api.eazo.com/hackathon/teams`)
- Auth method (Bearer token, API key header, etc.) and the key/token value
- Whether referral count (`referral_count`) is available in this response, or comes from a separate endpoint

> **Note on `referral_count`:** This is critical. It determines which teams qualify for the Demo (A-class slots: top 10 referrals per hub, threshold >500). If it's not in the team API, we need a separate endpoint or a webhook that pushes referral counts to us.

---

### 2. User Auth Token

**What it is:** The Eazo app needs to pass a user identity token into the voting WebViews so we know who is voting. This is how we enforce the 10-vote-per-hub budget and prevent double voting.

**How the WebView bridge works (our side):** We listen for a global variable injection:

```js
// We expect the app to inject this before the page loads,
// OR call this function after load:
window.EAZO_TOKEN = "...";
// or:
window.receiveAuthToken("...");
```

**What the token must contain** (after we decode/verify it):
- `user_id` — unique, stable user identifier (used to track their vote budget)
- `team_id` — the user's team identifier, same value as `team_id` in the team API above (needed for peer vote — to exclude their own team from the list)
- `hub` — which hub this user belongs to (so we auto-select the right tab)

**What we need from you:**
1. **Token format** — is it a standard JWT (RS256 / HS256 / ES256)? Or a different format?
2. **Verification key** — the public key or shared secret so we can validate the token server-side
3. **Payload field names** — what are the actual field names for user ID, team ID, and hub in your token? (e.g. is it `sub`, `userId`, or `user_id`?)
4. **Injection method** — does the app inject `window.EAZO_TOKEN` before load, call a function, or use `postMessage`? We'll adapt to whatever you already do.

> If you don't have a WebView bridge mechanism yet, the simplest path: inject `window.EAZO_TEAM = { userId, teamId, hub }` as a plain JS object before the WebView loads. No crypto required for MVP — we can add signature verification later.

---

### 3. IP Geolocation Confirmation (SH / Asia Online)

**What it is:** Per the event design, the Shanghai and Asia Online tabs should only be visible to users on China IPs.

**Our current implementation:** We call `ip-api.com` to detect country code and hide the SH/Asia Online tabs for non-CN IPs. This works for the web version.

**What we need from you:**
- For the **app WebView**: does Eazo already know the user's region/country from their account or device? If so, just include a `region` or `country` field in the auth token above — we'll use that instead of doing IP lookup ourselves. This is more reliable than IP detection.
- Confirmation of whether the restriction should apply at the **tab visibility** level (hide the tab entirely), or the **data level** (tabs visible but API rejects non-CN requests). We currently do tab-level hiding.

---

## What You Don't Need to Do

To be clear about what's fully handled on our side:

- ✅ All vote storage and deduplication
- ✅ 10-vote-per-user budget enforcement (per hub)
- ✅ Peer vote rules (3 votes, no self-vote, once only)
- ✅ Finalist calculation logic (referral / peer / online buckets, dedup, ny=15 slots, sf+sh=10 slots)
- ✅ Judge scoring interface
- ✅ Live leaderboard (OnAir)
- ✅ All frontend pages
- ✅ Database schema

---

## Deployment

We deploy to **Vercel**. Once you provide the three items above, we configure the environment variables and go live in under an hour. No access to Eazo infrastructure needed.

```
EAZO_API_BASE=https://...       # team data endpoint base URL
EAZO_API_KEY=...                # your API key
EAZO_JWT_SECRET=...             # token verification key
```

---

## Timeline Sensitivity

| Item | Needed by | Why |
|------|-----------|-----|
| Team data API + key | ASAP | We need to populate our DB before voting opens |
| Auth token spec | ASAP | Community vote and peer vote can't go live without it |
| Referral count data | Before submission deadline | Used to calculate finalist A-slots |
| IP/region field in token | Before event | Needed for SH/Asia Online gate |

---

## Questions? 

Everything above is in the codebase: `github.com/kristywhim/eazo-2026-hackathon`

The three `⚠️ PENDING` markers in the code correspond exactly to the three sections above:
- `api/sync-teams.js` — team data API
- `api/_auth.js` — token verification
- `api/detect-hub.js` — IP / region logic
