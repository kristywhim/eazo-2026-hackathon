// POST /api/judge-score
// Submit or update judge scores. Each score is for a specific APP (a team
// may have multiple apps in Demo; each gets scored separately; team's J =
// AVG across all judged apps).
// Rubric: 5 dimensions × 10 pts each = 50 pts/judge (per Eazo Judge Guide 2026)
//
// Body: { hub, judgeCode, scores: [{ appId, completeness, innovation, technical, design, commercial, notes }] }
//   Legacy compat: also accepts `teamId` → resolved to team's first app.
//
// GET /api/judge-score?hub=sf&code=JUDGE_SF_01
// Response: { scores: [{ appId, teamId, teamName, appName, ...criteria, total, notes }] }

const { getClient } = require('./_supabase');

const PRIZE_HUBS = ['sf', 'ny', 'sh'];
const CRITERIA   = ['completeness', 'innovation', 'technical', 'design', 'commercial'];

function clamp10(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(10, n));
}

async function validateJudgeCode(supabase, code, hub) {
  const { data, error } = await supabase
    .from('judge_codes')
    .select('code, hub, label')
    .eq('code', code)
    .single();
  if (error || !data) return null;
  if (data.hub !== hub && data.code !== 'JUDGE2026') return null;
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getClient();

  // ── GET: fetch this judge's existing scores (with app + team info) ──
  if (req.method === 'GET') {
    const { hub, code } = req.query;
    if (!PRIZE_HUBS.includes(hub)) return res.status(400).json({ error: 'Invalid hub' });

    const judge = await validateJudgeCode(supabase, code, hub);
    if (!judge) return res.status(403).json({ error: 'Invalid judge code for this hub' });

    const { data: scores, error } = await supabase
      .from('judge_scores')
      .select(`
        app_id, team_id, completeness, innovation, technical, design, commercial, notes, updated_at,
        apps   ( id, name ),
        teams  ( id, name )
      `)
      .eq('judge_id', code)
      .eq('hub', hub);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      judgeLabel: judge.label,
      hub,
      scores: (scores || []).map(s => ({
        appId:        s.app_id,
        teamId:       s.team_id,
        teamName:     s.teams?.name,
        appName:      s.apps?.name,
        completeness: s.completeness,
        innovation:   s.innovation,
        technical:    s.technical,
        design:       s.design,
        commercial:   s.commercial,
        total: CRITERIA.reduce((sum, k) => sum + (Number(s[k]) || 0), 0),
        notes:        s.notes,
        updatedAt:    s.updated_at,
      })),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { hub, judgeCode, scores } = req.body || {};
  if (!PRIZE_HUBS.includes(hub)) return res.status(400).json({ error: 'Invalid hub' });
  if (!Array.isArray(scores) || scores.length === 0) return res.status(400).json({ error: 'scores array required' });

  const judge = await validateJudgeCode(supabase, judgeCode, hub);
  if (!judge) return res.status(403).json({ error: 'Invalid judge code for this hub' });

  // Resolve appId for each score: prefer s.appId; fallback to s.teamId → first app
  const teamIdsForLookup = scores.filter(s => !s.appId && s.teamId).map(s => s.teamId);
  let teamFirstAppMap = {};
  if (teamIdsForLookup.length) {
    const { data: lookupApps } = await supabase
      .from('apps')
      .select('id, team_id, created_at')
      .in('team_id', teamIdsForLookup)
      .order('created_at', { ascending: true });
    (lookupApps || []).forEach(a => {
      if (!teamFirstAppMap[a.team_id]) teamFirstAppMap[a.team_id] = a.id;
    });
  }

  // Resolve team_id for each app (denormalized on judge_scores row)
  const appIds = scores.map(s => s.appId || teamFirstAppMap[s.teamId]).filter(Boolean);
  let appTeamMap = {};
  if (appIds.length) {
    const { data: appsLookup } = await supabase
      .from('apps')
      .select('id, team_id')
      .in('id', appIds);
    (appsLookup || []).forEach(a => { appTeamMap[a.id] = a.team_id; });
  }

  const rows = scores.map(s => {
    const appId = s.appId || teamFirstAppMap[s.teamId];
    if (!appId) return null;
    return {
      judge_id:     judgeCode,
      app_id:       appId,
      team_id:      appTeamMap[appId] || s.teamId,
      hub,
      completeness: clamp10(s.completeness),
      innovation:   clamp10(s.innovation),
      technical:    clamp10(s.technical),
      design:       clamp10(s.design),
      commercial:   clamp10(s.commercial),
      notes:        s.notes || null,
      updated_at:   new Date().toISOString(),
    };
  }).filter(Boolean);

  if (!rows.length) return res.status(400).json({ error: 'No valid scores (missing appId/teamId)' });

  // Upsert by (judge_id, app_id) — one judge can score same app once
  // Note: existing schema unique constraint is (judge_id, team_id). Until a
  // future migration tightens this to (judge_id, app_id), we check first.
  const judgeAppKeys = rows.map(r => ({ judge_id: r.judge_id, app_id: r.app_id }));
  const { data: existing } = await supabase
    .from('judge_scores')
    .select('id, judge_id, app_id')
    .eq('judge_id', judgeCode)
    .in('app_id', rows.map(r => r.app_id));

  const existingByApp = {};
  (existing || []).forEach(e => { existingByApp[e.app_id] = e.id; });

  let saved = 0;
  for (const row of rows) {
    if (existingByApp[row.app_id]) {
      const { error } = await supabase
        .from('judge_scores')
        .update(row)
        .eq('id', existingByApp[row.app_id]);
      if (!error) saved++;
    } else {
      const { error } = await supabase.from('judge_scores').insert(row);
      if (!error) saved++;
    }
  }

  return res.json({ ok: true, saved });
};
