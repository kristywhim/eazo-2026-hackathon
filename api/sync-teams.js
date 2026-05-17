// POST /api/sync-teams?secret=ADMIN_SECRET
// Pulls REGISTRATION rows from the hackathon Google Sheet (Tally form → Sheet)
// and upserts them into the local `teams` table.
//
// Run this manually after registration opens, then periodically (or on demand).
// Idempotent: keyed on Tally `Submission ID`.
//
// ── Architecture note ────────────────────────────────────────────────
// The gsheet only carries REGISTRATION data: team roster, region, track,
// captain email. **Project details (app title, URL, cover, description)
// never land in the sheet.** They live in Eazo's `creator_apps` table —
// teams build their actual hackathon app on Eazo Creator inside the
// Eazo Mobile app.
//
// Eazo's backend (per `_reference/hackathon-api.md`) does the join:
//
//   sheet col 7 "Eazo Creator registration email"
//     ↔ Eazo `users.email`
//     → Eazo `creator_apps.*` (appTitle, appUrl, coverUrl, …)
//
// and exposes the merged result at `GET /api/v1/hackathon/apps`.
//
// So this sync produces "skeleton" rows (team_id, name, hub, track, roster)
// with project fields empty. To populate project info, we'll later call
// Eazo's portal endpoint (separate sync, or swap this one) when it's live.
// ──────────────────────────────────────────────────────────────────────
//
// IMPORTANT: We parse by COLUMN INDEX, not header text. Header text changes
// (English/Chinese, renames). Column positions are the stable contract.
//
// Required env vars:
//   EAZO_SHEETS_API_KEY        — Google Sheets API v4 key (read-only public sheet)
//   SUPABASE_URL               — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY  — service-role key for upserts
//
// Optional env vars:
//   EAZO_SHEET_ID    — override default sheet
//   EAZO_SHEET_RANGE — defaults to '工作表1'!A2:Z (skip header row)
//   ADMIN_SECRET     — defaults to 'HACKATHON_ADMIN_2026'

const { getClient } = require('./_supabase');

// ── Config ─────────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'HACKATHON_ADMIN_2026';
const SHEET_ID     = process.env.EAZO_SHEET_ID || '1W7VBHzbeHyxGaIIg_UonmZgCVbZpoZ5x20PvlWvG8kE';
const SHEET_RANGE  = process.env.EAZO_SHEET_RANGE || "'工作表1'!A2:Z";
const API_KEY      = process.env.EAZO_SHEETS_API_KEY || process.env.HACKATHON_SHEETS_API_KEY;

// ── Column map (0-based) for the registration sheet 1W7V... ─────────
// Verified by reading row 1 (header) on 2026-05-16.
// All project-details columns (title / URL / cover / description) are
// intentionally absent — those live in Eazo Creator, not Tally. See file header.
const COL = {
  submissionId: 0,
  // 1 = Respondent ID (Tally internal)
  submittedAt:  2,
  // 3 = Submission PDF, 4 = Submission preview (Tally artifacts)
  region:       5,
  teamName:     6,
  // 7 = Eazo Creator registration email (PII — used by Eazo's portal join, not stored here)
  track:        8,
  teamSize:     9,
  leaderName:  10,
  // 11 = leader phone (PII)
  // 12 = leader email (PII — fallback portal-join key, not stored here)
  leaderRole:  13,
  member2Name: 14,
  // 15 = member 2 email (PII)
  member2Role: 16,
  member3Name: 17,
  // 18 = member 3 email (PII)
  member3Role: 19,
  // 20-22 = Code of Conduct confirmations
  // 23     = freeform "anything else" note
};

// ── Region text → hub enum (matches Eazo v1.2 alias list, kept at 5 hubs for now;
//    Stage 2 will collapse sf+go→global, sh+ao→asia, ny→new_york) ────
const HUB_ALIASES = [
  { hub: 'sf', needles: ['san francisco'] },
  { hub: 'go', needles: ['global online'] },
  { hub: 'sh', needles: ['shanghai offline', 'shanghai'] },
  { hub: 'ao', needles: ['asian online', 'asia online'] },
  { hub: 'ny', needles: ['new york offline', 'new york'] },
];

function classifyHub(rawText) {
  if (!rawText) return null;
  const t = String(rawText).toLowerCase().trim();
  for (const { hub, needles } of HUB_ALIASES) {
    if (needles.some(n => t.includes(n))) return hub;
  }
  return null;
}

// ── Track text → track enum ──────────────────────────────────────────
const TRACK_KEYWORDS = {
  superparent: ['superparent', 'super parent', 'parent', '亲子', '家长'],
  companion:   ['companion', 'ai companion', '陪伴'],
  lifeos:      ['lifeos', 'life os', '生活操作系统', '生活'],
  body:        ['body', 'health', '健康', '身体'],
};

function classifyTrack(rawText) {
  if (!rawText) return 'wildcard';
  const t = String(rawText).toLowerCase();
  for (const [code, kws] of Object.entries(TRACK_KEYWORDS)) {
    if (kws.some(k => t.includes(k))) return code;
  }
  return 'wildcard';
}

// ── Date parsing — Tally writes ISO-ish strings; tolerate variants ──
function parseSubmittedAt(raw) {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ── Row → team record ─────────────────────────────────────────────────
function mapRow(row) {
  const submissionId = row[COL.submissionId];
  if (!submissionId) return null;          // skip empty rows

  const teamName = (row[COL.teamName] || '').trim()
                   || `Team ${String(submissionId).slice(-4)}`;

  const hub = classifyHub(row[COL.region]);
  if (!hub) {
    // Unrecognized region — skip rather than write a row that violates the CHECK constraint
    console.warn('[sync-teams] skipping row, unknown region:', row[COL.region], 'submissionId:', submissionId);
    return null;
  }
  const track = classifyTrack(row[COL.track]);

  // NOTE: this sheet doesn't (yet) carry project-submission columns. Until those
  // columns appear (Tally extension or separate submission flow), project_name
  // falls back to team_name and project_desc / thumb_url stay null.
  return {
    eazo_team_id:   String(submissionId),
    name:           teamName,
    project_name:   teamName,
    project_desc:   null,
    hub,
    track,
    icon_emoji:     '🚀',
    icon_bg:        '#CCF0E3',
    thumb_url:      null,
    referral_count: 0,                                // not in sheet — populated separately if/when Eazo provides
    submitted_at:   parseSubmittedAt(row[COL.submittedAt]),
  };
}

// ── Fetch sheet via Google Sheets API v4 ─────────────────────────────
async function fetchSheetRows() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`
            + `/values/${encodeURIComponent(SHEET_RANGE)}?key=${API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Sheets API ${r.status}: ${body.slice(0, 300)}`);
  }
  const { values } = await r.json();
  return values || [];
}

// ── Handler ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.query.secret || req.body?.secret;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  if (!API_KEY) {
    return res.status(503).json({
      error: 'EAZO_SHEETS_API_KEY not configured — set this env var in Vercel.',
    });
  }

  let rawRows;
  try {
    rawRows = await fetchSheetRows();
  } catch (err) {
    return res.status(502).json({ error: `Failed to read sheet: ${err.message}` });
  }

  const mapped = rawRows.map(mapRow).filter(Boolean);

  if (!mapped.length) {
    return res.json({
      ok: true,
      upserted: 0,
      rowsRead: rawRows.length,
      message: 'No valid rows to sync (sheet empty or all rows skipped).',
    });
  }

  const supabase = getClient();
  const { error } = await supabase
    .from('teams')
    .upsert(mapped, { onConflict: 'eazo_team_id' });

  if (error) {
    console.error('[sync-teams] upsert error:', error);
    return res.status(500).json({ error: error.message });
  }

  // ── Ensure every team has at least one app row ───────────────────
  // The gsheet doesn't carry project details (they live in Eazo Creator),
  // so we create a placeholder app per team using team_name as app name.
  // When Eazo portal pushes real apps (with eazo_app_id), use upsert on
  // eazo_app_id; this placeholder stays as a fallback.
  const { data: insertedTeams } = await supabase
    .from('teams')
    .select('id, name, hub, track, icon_emoji, icon_bg')
    .in('eazo_team_id', mapped.map(t => t.eazo_team_id));

  const teamIds = (insertedTeams || []).map(t => t.id);
  const { data: existingApps } = await supabase
    .from('apps')
    .select('team_id')
    .in('team_id', teamIds);
  const teamsWithApps = new Set((existingApps || []).map(a => a.team_id));

  const newApps = (insertedTeams || [])
    .filter(t => !teamsWithApps.has(t.id))
    .map(t => ({
      team_id:    t.id,
      name:       t.name,                  // placeholder = team name
      hub:        t.hub,
      track:      t.track,
      icon_emoji: t.icon_emoji,
      icon_bg:    t.icon_bg,
    }));

  let appsCreated = 0;
  if (newApps.length) {
    const { error: appErr } = await supabase.from('apps').insert(newApps);
    if (appErr) console.error('[sync-teams] apps insert error:', appErr);
    else appsCreated = newApps.length;
  }

  // Tally per-hub for the response — useful for ops to spot data issues
  const byHub = mapped.reduce((acc, t) => {
    acc[t.hub] = (acc[t.hub] || 0) + 1;
    return acc;
  }, {});

  return res.json({
    ok: true,
    upserted: mapped.length,
    appsCreated,
    rowsRead: rawRows.length,
    skipped: rawRows.length - mapped.length,
    byHub,
  });
};
