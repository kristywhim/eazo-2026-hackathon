// POST /api/vote
// Cast community votes on a SPECIFIC APP. Requires auth token.
//
// Body: { appId: uuid, count: number }
//   (legacy: also accepts `teamId`, treated as "vote for the team's first app")
//
// Response: { ok: true, region: 'sf'|'ny'|'sh', remainingVotes: number }
//
// Vote budget: 10 votes per PRIZE-POOL REGION (not per hub, not per app).
// A user can split their 10 votes across multiple apps in the region.

const { getClient } = require('./_supabase');
const { requireAuth } = require('./_auth');
const { VOTING_DEADLINES_DATE: DEADLINES } = require('./_deadlines');

const MAX_VOTES = 10;

function regionFor(hub) {
  return { sf:'sf', go:'sf', sh:'sh', ao:'sh', ny:'ny' }[hub];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let userId;
  try {
    ({ userId } = await requireAuth(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  let { appId, teamId, count = 1 } = req.body || {};
  if (!Number.isInteger(count) || count < 1 || count > 10)
    return res.status(400).json({ error: 'count must be integer 1–10' });

  const supabase = getClient();

  // Legacy: teamId given — resolve to that team's first app
  if (!appId && teamId) {
    const { data: firstApp } = await supabase
      .from('apps')
      .select('id')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (firstApp) appId = firstApp.id;
  }
  if (!appId) return res.status(400).json({ error: 'Missing appId (or legacy teamId)' });

  // ── Resolve app → its hub + team ────────────────────────────────
  const { data: app, error: appErr } = await supabase
    .from('apps')
    .select('id, team_id, hub')
    .eq('id', appId)
    .single();

  if (appErr || !app) return res.status(404).json({ error: 'App not found' });

  const hub    = app.hub;
  const region = regionFor(hub);

  // ── Check deadline ──────────────────────────────────────────────
  if (Date.now() > DEADLINES[hub].getTime()) {
    return res.status(410).json({ error: 'Voting has closed for this region' });
  }

  // ── Region budget check ─────────────────────────────────────────
  const { data: budget } = await supabase
    .from('user_region_budget')
    .select('votes_used')
    .eq('user_id', userId)
    .eq('region', region)
    .maybeSingle();

  const used = budget?.votes_used || 0;
  if (used + count > MAX_VOTES) {
    return res.status(409).json({
      error: `Not enough votes. You have ${MAX_VOTES - used} remaining in ${region.toUpperCase()} region.`,
      remainingVotes: MAX_VOTES - used,
      region,
    });
  }

  // ── Upsert community_votes row (per-app) ────────────────────────
  // Note: existing unique constraint is on (user_id, team_id). With app_id
  // added, we need to also enforce uniqueness per (user_id, app_id). The
  // migration 005 introduces app_id but keeps the old constraint for compat.
  // We do a check-then-upsert by app_id explicitly.
  const { data: existing } = await supabase
    .from('community_votes')
    .select('id, votes_count')
    .eq('user_id', userId)
    .eq('app_id', appId)
    .maybeSingle();

  const newCount = (existing?.votes_count || 0) + count;
  if (newCount > MAX_VOTES) {
    return res.status(409).json({ error: `Cap reached on this app (${MAX_VOTES} max per app).` });
  }

  let voteErr;
  if (existing) {
    ({ error: voteErr } = await supabase
      .from('community_votes')
      .update({ votes_count: newCount, updated_at: new Date().toISOString() })
      .eq('id', existing.id));
  } else {
    ({ error: voteErr } = await supabase
      .from('community_votes')
      .insert({
        user_id:     userId,
        team_id:     app.team_id,
        app_id:      appId,
        hub,
        votes_count: count,
      }));
  }

  if (voteErr) {
    console.error('[vote] upsert error:', voteErr);
    return res.status(500).json({ error: voteErr.message });
  }

  // ── Update region budget ─────────────────────────────────────────
  const { error: budgetErr } = await supabase
    .from('user_region_budget')
    .upsert(
      { user_id: userId, region, votes_used: used + count, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,region' }
    );

  if (budgetErr) console.error('[vote] budget upsert error:', budgetErr);

  return res.json({
    ok: true,
    region,
    appId,
    remainingVotes: MAX_VOTES - used - count,
  });
};
