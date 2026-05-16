// POST /api/sync-teams?secret=ADMIN_SECRET
// Syncs team data from Eazo's API into our Supabase `teams` table.
// Run this once after team registration closes, and again if Eazo updates data.
//
// ⚠️  PENDING from Eazo team:
//   - EAZO_API_BASE  : base URL for their team list API
//   - EAZO_API_KEY   : auth key for their API
//   - Field mapping  : exact field names in their response
//
// Expected Eazo API response (approximate — confirm with Eazo):
// GET ${EAZO_API_BASE}/hackathon/teams
// [
//   {
//     team_id: "abc123",
//     team_name: "Team Harmony",
//     project_name: "FamilySync AI",
//     project_desc: "...",
//     hub: "sf",          // sf | ny | sh | go | ao
//     track: "superparent",
//     referral_count: 320,
//     submitted_at: "2026-05-23T18:30:00Z",
//   },
//   ...
// ]

const { getClient } = require('./_supabase');

const ADMIN_SECRET  = process.env.ADMIN_SECRET   || 'HACKATHON_ADMIN_2026';
const EAZO_API_BASE = process.env.EAZO_API_BASE  || null;  // e.g. 'https://api.eazo.com'
const EAZO_API_KEY  = process.env.EAZO_API_KEY   || null;

// ── Field mapping from Eazo → our schema ──────────────────────────
// UPDATE THESE once Eazo confirms their API field names
function mapEazoTeam(t) {
  return {
    eazo_team_id:   String(t.team_id || t.id),
    name:           t.team_name || t.name,
    project_name:   t.project_name || t.project,
    project_desc:   t.project_desc || t.description || null,
    hub:            normalizeHub(t.hub || t.location || 'sf'),
    track:          normalizeTrack(t.track || t.category || 'wildcard'),
    icon_emoji:     t.icon_emoji || '🚀',
    icon_bg:        t.icon_bg || '#CCF0E3',
    thumb_url:      t.thumb_url || t.cover_image || null,
    referral_count: Number(t.referral_count || t.referrals || 0),
    submitted_at:   t.submitted_at || t.created_at || new Date().toISOString(),
  };
}

function normalizeHub(h) {
  const map = { sf:1, ny:1, sh:1, go:1, ao:1,
    'san francisco':1, 'new york':1, shanghai:1,
    'global online':1, 'asia online':1 };
  const raw = h.toLowerCase().replace(/\s+/g,'_');
  return { san_francisco:'sf', new_york:'ny', shanghai:'sh',
           global_online:'go', asia_online:'ao' }[raw] || h.toLowerCase().slice(0,2) || 'sf';
}

function normalizeTrack(t) {
  const valid = ['superparent','companion','lifeos','body','wildcard'];
  const raw = t.toLowerCase().replace(/[^a-z]/g,'');
  if (valid.includes(raw)) return raw;
  if (raw.includes('parent')) return 'superparent';
  if (raw.includes('companion') || raw.includes('ai')) return 'companion';
  if (raw.includes('life') || raw.includes('os')) return 'lifeos';
  if (raw.includes('body') || raw.includes('health')) return 'body';
  return 'wildcard';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.query.secret || req.body?.secret;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  // ── Fetch from Eazo API ─────────────────────────────────────────
  if (!EAZO_API_BASE) {
    return res.status(503).json({
      error: 'EAZO_API_BASE not configured — set env var once Eazo provides the endpoint',
    });
  }

  let eazoTeams;
  try {
    const eazoRes = await fetch(`${EAZO_API_BASE}/hackathon/teams`, {
      headers: {
        'Authorization': `Bearer ${EAZO_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!eazoRes.ok) {
      return res.status(502).json({ error: `Eazo API returned ${eazoRes.status}` });
    }

    const body = await eazoRes.json();
    // Handle both array and { teams: [...] } response shapes
    eazoTeams = Array.isArray(body) ? body : (body.teams || body.data || []);
  } catch (err) {
    return res.status(502).json({ error: `Failed to reach Eazo API: ${err.message}` });
  }

  if (!eazoTeams.length) {
    return res.status(200).json({ ok: true, upserted: 0, message: 'No teams returned from Eazo API' });
  }

  // ── Upsert into Supabase ─────────────────────────────────────────
  const supabase = getClient();
  const mapped = eazoTeams.map(mapEazoTeam);

  const { error } = await supabase
    .from('teams')
    .upsert(mapped, { onConflict: 'eazo_team_id' });

  if (error) {
    console.error('[sync-teams] upsert error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.json({ ok: true, upserted: mapped.length });
};
