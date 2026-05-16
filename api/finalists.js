// GET  /api/finalists?hub=sf[&public=1]
// POST /api/finalists/calculate?hub=sf&secret=ADMIN_SECRET
//
// GET  returns finalist list for display (judge scorer + finalist announcement page)
// POST triggers the finalist calculation (called once per hub after voting closes)
//
// Finalist rules (from prize logic):
//   SH + Asia Online (prize_hub='sh'):
//     A: referral top 10 (>500 threshold)
//     B: peer vote top 10 (>200 threshold)
//     C: Asia Online (ao) top 10 by community votes
//     Total: 30 teams (20 offline + 10 online), deduped
//
//   SF + Global Online (prize_hub='sf'):
//     A: referral top 10 (>500 threshold)
//     B: peer vote top 10 (>200 threshold)
//     D: Global Online (go) top 10 by community votes
//     Total: 30 teams (20 offline + 10 online), deduped
//
//   NY (prize_hub='ny'):
//     A: referral top 15 (>500 threshold)
//     B: peer vote top 15 (>200 threshold)
//     Total: 30 teams (all offline), deduped

const { getClient } = require('./_supabase');

const PRIZE_HUBS = ['sf', 'ny', 'sh'];
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'HACKATHON_ADMIN_2026';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getClient();

  // ── POST /api/finalists/calculate ───────────────────────────────
  if (req.method === 'POST') {
    const secret = req.query.secret || req.body?.secret;
    if (secret !== ADMIN_SECRET) {
      return res.status(403).json({ error: 'Invalid admin secret' });
    }

    const hub = req.query.hub || req.body?.hub;
    if (!PRIZE_HUBS.includes(hub)) {
      return res.status(400).json({ error: `hub must be one of: ${PRIZE_HUBS.join(', ')}` });
    }

    // Call the Postgres function that does the full calculation + dedup
    const { data, error } = await supabase.rpc('calculate_finalists', { p_prize_hub: hub });

    if (error) {
      console.error('[finalists] calculation error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: true,
      hub,
      count: data?.length || 0,
      finalists: data,
      calculatedAt: new Date().toISOString(),
    });
  }

  // ── GET /api/finalists?hub=sf ────────────────────────────────────
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const hub = req.query.hub;
  if (!PRIZE_HUBS.includes(hub)) {
    return res.status(400).json({ error: `hub must be one of: ${PRIZE_HUBS.join(', ')}` });
  }

  const { data: finalists, error } = await supabase
    .from('finalists')
    .select(`
      overall_rank,
      source_hub,
      qualification_method,
      rank_in_method,
      announced,
      composite_score,
      calculated_at,
      teams (
        id, name, project_name, project_desc, hub, track, icon_emoji, icon_bg
      )
    `)
    .eq('prize_hub', hub)
    .order('overall_rank', { ascending: true });

  if (error) {
    console.error('[finalists] fetch error:', error);
    return res.status(500).json({ error: error.message });
  }

  const calculated = (finalists?.length || 0) > 0;
  const calculatedAt = finalists?.[0]?.calculated_at || null;

  return res.json({
    calculated,
    calculatedAt,
    hub,
    finalists: (finalists || []).map(f => ({
      rank:                 f.overall_rank,
      teamId:               f.teams?.id,
      teamName:             f.teams?.name,
      projectName:          f.teams?.project_name,
      projectDesc:          f.teams?.project_desc,
      sourceHub:            f.source_hub,
      track:                f.teams?.track,
      iconEmoji:            f.teams?.icon_emoji,
      qualificationMethod:  f.qualification_method,
      rankInMethod:         f.rank_in_method,
      compositeScore:       f.composite_score,
      announced:            f.announced,
    })),
  });
};
