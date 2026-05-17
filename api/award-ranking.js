// GET /api/award-ranking?hub=sf|ny|sh
// GET /api/award-ranking?hub=all  → returns all 3 regions side-by-side
// GET /api/award-ranking           → same as ?hub=all
//
// Returns the final award ranking per prize-pool region. Used by the
// Finalist Dashboard at the award ceremony — the host opens the page
// when voting closes and sees who wins per region.
//
// Composite scoring (per prize-logic-v4):
//   composite = 0.50 * V_norm + 0.40 * J_norm + 0.10 * P_norm
//   where V/J/P are min-max normalized within the prize hub so different
//   scales (votes can be 1000s, judge avg is 0–50, peer is 0–30) don't
//   dominate.
//
// This endpoint is computed ENTIRELY in JS from existing tables. It does
// not require any SQL changes — works against the schema as it stands.
//
// Public read endpoint (no auth) — the dashboard is open to the host.

const { getClient } = require('./_supabase');

const PRIZE_HUBS = ['sf', 'ny', 'sh'];
const PRIZE_LABELS = {
  sf: 'SF · Bay Area + Global Online',
  ny: 'NY · New York',
  sh: 'SH · Shanghai + Asia Online',
};

// ── Per-region composite computation ─────────────────────────────────
async function calculateForRegion(supabase, prize_hub) {
  // 1. Fetch finalists for this prize_hub
  const { data: finalists, error: finalistsErr } = await supabase
    .from('finalists')
    .select(`
      team_id, source_hub, qualification_method, rank_in_method, overall_rank,
      teams ( name, project_name, track, hub, icon_emoji, icon_bg )
    `)
    .eq('prize_hub', prize_hub);

  if (finalistsErr) {
    console.error('[award-ranking] finalists error:', finalistsErr);
    return { error: finalistsErr.message, teams: [] };
  }
  if (!finalists || finalists.length === 0) {
    return { teams: [], note: 'No finalists calculated yet for this region. Run calculate_finalists() first.' };
  }

  const teamIds = finalists.map(f => f.team_id);

  // 2. Fetch component scores in parallel (V/J/P)
  const [voteRes, peerRes, judgeRes] = await Promise.all([
    supabase.from('community_votes').select('team_id, votes_count').in('team_id', teamIds),
    supabase.from('peer_votes').select('voted_team_id').in('voted_team_id', teamIds),
    supabase.from('judge_scores').select('team_id, completeness, innovation, technical, design, commercial').in('team_id', teamIds),
  ]);

  // Sum community votes per team
  const V = {};
  for (const v of voteRes.data || []) {
    V[v.team_id] = (V[v.team_id] || 0) + (v.votes_count || 0);
  }

  // Count peer votes per team
  const P = {};
  for (const p of peerRes.data || []) {
    P[p.voted_team_id] = (P[p.voted_team_id] || 0) + 1;
  }

  // Average judge total per team (each judge → 5 dims × 10 = 50 max)
  const judgeAcc = {};
  for (const j of judgeRes.data || []) {
    const total = (Number(j.completeness) || 0) + (Number(j.innovation) || 0) +
                  (Number(j.technical) || 0)    + (Number(j.design) || 0) +
                  (Number(j.commercial) || 0);
    if (!judgeAcc[j.team_id]) judgeAcc[j.team_id] = { sum: 0, count: 0 };
    judgeAcc[j.team_id].sum   += total;
    judgeAcc[j.team_id].count += 1;
  }
  const J = {};
  for (const tid of Object.keys(judgeAcc)) {
    J[tid] = judgeAcc[tid].sum / judgeAcc[tid].count;
  }

  // 3. Build base records
  const base = finalists.map(f => ({
    teamId:               f.team_id,
    teamName:             f.teams?.name        || '(unknown)',
    projectName:          f.teams?.project_name|| '',
    track:                f.teams?.track       || 'wildcard',
    sourceHub:            f.source_hub,
    qualificationMethod:  f.qualification_method,
    iconEmoji:            f.teams?.icon_emoji  || '🚀',
    iconBg:               f.teams?.icon_bg     || '#CCF0E3',
    V: V[f.team_id] || 0,
    J: J[f.team_id] || 0,
    P: P[f.team_id] || 0,
    judgeCount: judgeAcc[f.team_id]?.count || 0,
  }));

  // 4. Min-max normalize each component within the region
  const minMax = (arr) => {
    if (!arr.length) return [0, 0];
    let mn = arr[0], mx = arr[0];
    for (const x of arr) { if (x < mn) mn = x; if (x > mx) mx = x; }
    return [mn, mx];
  };
  const norm01 = (val, mn, mx) => (mx === mn ? 0.5 : (val - mn) / (mx - mn));

  const [vMin, vMax] = minMax(base.map(b => b.V));
  const [jMin, jMax] = minMax(base.map(b => b.J));
  const [pMin, pMax] = minMax(base.map(b => b.P));

  const withComposite = base.map(b => {
    const vNorm = norm01(b.V, vMin, vMax);
    const jNorm = norm01(b.J, jMin, jMax);
    const pNorm = norm01(b.P, pMin, pMax);
    const composite = 0.50 * vNorm + 0.40 * jNorm + 0.10 * pNorm;
    return {
      ...b,
      vNorm: Math.round(vNorm * 10000) / 10000,
      jNorm: Math.round(jNorm * 10000) / 10000,
      pNorm: Math.round(pNorm * 10000) / 10000,
      composite: Math.round(composite * 10000) / 10000,
    };
  });

  // 5. Sort by composite desc, then judge avg, then community votes
  withComposite.sort((a, b) =>
    b.composite - a.composite || b.J - a.J || b.V - a.V
  );

  // 6. Tag award rank
  return {
    teams: withComposite.map((t, i) => ({ ...t, awardRank: i + 1 })),
    judgesParticipated: Object.keys(judgeAcc).length > 0,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const hub = (req.query.hub || 'all').toLowerCase();
  const supabase = getClient();

  if (hub === 'all') {
    const [sf, ny, sh] = await Promise.all(
      PRIZE_HUBS.map(h => calculateForRegion(supabase, h))
    );
    return res.json({
      calculatedAt: new Date().toISOString(),
      regions: {
        sf: { label: PRIZE_LABELS.sf, ...sf },
        ny: { label: PRIZE_LABELS.ny, ...ny },
        sh: { label: PRIZE_LABELS.sh, ...sh },
      },
    });
  }

  if (!PRIZE_HUBS.includes(hub)) {
    return res.status(400).json({ error: `hub must be one of: ${PRIZE_HUBS.join(', ')}, all` });
  }

  const result = await calculateForRegion(supabase, hub);
  return res.json({
    calculatedAt: new Date().toISOString(),
    hub,
    label: PRIZE_LABELS[hub],
    ...result,
  });
};
