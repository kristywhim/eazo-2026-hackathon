// POST /api/seed-mock-apps?secret=ADMIN_SECRET
// Adds 2–3 mock APPS per existing mock team so the multi-app flow can be
// demoed end-to-end (comm-vote shows each app as its own card; special-award
// candidates surface teams with one app > 200 votes who didn't make Demo).
//
// Targets only teams whose eazo_team_id starts with 'MOCK_' (from
// seed-mock-teams). Real Tally-synced teams are untouched.
//
// Idempotent: existing mock apps (matched by name + team_id) are kept.

const { getClient } = require('./_supabase');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'HACKATHON_ADMIN_2026';

const APP_NAMES = [
  'Alpha',  'Beta',   'Gamma', 'Delta',  'Echo',   'Foxtrot',
  'Atlas',  'Aurora', 'Pulse', 'Pilot',  'Sigma',  'Helix',
];
const ADJ = ['Smart', 'Auto', 'Daily', 'Magic', 'Calm', 'Bright', 'Loop', 'Snap'];

function rand(n) { return Math.floor(Math.random() * n); }
function pickAppName(seed) {
  const a = ADJ[seed % ADJ.length];
  const n = APP_NAMES[(seed * 3) % APP_NAMES.length];
  return `${a}${n}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.query.secret || req.body?.secret;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  const supabase = getClient();

  // 1. Fetch all mock teams
  const { data: mockTeams, error: teamErr } = await supabase
    .from('teams')
    .select('id, eazo_team_id, name, hub, track, icon_emoji, icon_bg')
    .like('eazo_team_id', 'MOCK_%');

  if (teamErr) return res.status(500).json({ error: teamErr.message });
  if (!mockTeams || !mockTeams.length) {
    return res.json({ ok: true, message: 'No MOCK_ teams found. Run /api/seed-mock-teams first.' });
  }

  const teamIds = mockTeams.map(t => t.id);

  // 2. See which apps already exist per team
  const { data: existingApps } = await supabase
    .from('apps')
    .select('team_id, name')
    .in('team_id', teamIds);

  const namesByTeam = {};
  (existingApps || []).forEach(a => {
    namesByTeam[a.team_id] = namesByTeam[a.team_id] || new Set();
    namesByTeam[a.team_id].add(a.name);
  });

  // 3. Compose new apps: each team gets total 2-3 apps (we add what's missing
  //    until they have at least 2; some get 3 to demo the variation)
  const toInsert = [];
  let seed = 0;
  for (const t of mockTeams) {
    const existing = namesByTeam[t.id] || new Set();
    const targetCount = 2 + (seed % 3 === 0 ? 1 : 0);  // 2 or 3
    let extraNeeded = Math.max(0, targetCount - existing.size);
    let attempt = 0;
    while (extraNeeded > 0 && attempt < 12) {
      const name = pickAppName(seed + attempt);
      if (!existing.has(name)) {
        toInsert.push({
          team_id:    t.id,
          name,
          description: `Mock app for ${t.name}. (Auto-generated for demo — replace with real Eazo Creator data when portal goes live.)`,
          hub:        t.hub,
          track:      t.track,
          icon_emoji: t.icon_emoji || '🚀',
          icon_bg:    t.icon_bg    || '#CCF0E3',
        });
        existing.add(name);
        extraNeeded--;
      }
      attempt++;
    }
    seed++;
  }

  if (!toInsert.length) {
    return res.json({ ok: true, inserted: 0, message: 'All mock teams already have ≥ 2 apps.' });
  }

  const { error: insertErr } = await supabase.from('apps').insert(toInsert);
  if (insertErr) {
    console.error('[seed-mock-apps] insert error:', insertErr);
    return res.status(500).json({ error: insertErr.message });
  }

  // Summary by team
  const perTeam = {};
  for (const a of toInsert) perTeam[a.team_id] = (perTeam[a.team_id] || 0) + 1;

  return res.json({
    ok: true,
    teamsTouched: Object.keys(perTeam).length,
    appsAdded:    toInsert.length,
  });
};
