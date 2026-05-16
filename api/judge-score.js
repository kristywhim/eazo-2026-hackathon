// POST /api/judge-score
// Submit or update judge scores for finalist teams.
//
// Body: { hub, judgeCode, scores: [{ teamId, c1, c2, c3, notes }] }
// Response: { ok: true, saved: number }
//
// GET /api/judge-score?hub=sf&code=JUDGE_SF_01
// Response: { scores: [{ teamId, c1, c2, c3, notes, total }] }

const { getClient } = require('./_supabase');

const PRIZE_HUBS = ['sf', 'ny', 'sh'];

async function validateJudgeCode(supabase, code, hub) {
  const { data, error } = await supabase
    .from('judge_codes')
    .select('code, hub, label')
    .eq('code', code)
    .single();

  if (error || !data) return null;
  // Master code is valid for all hubs; specific codes tied to their hub
  if (data.hub !== hub && data.code !== 'JUDGE2026') return null;
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getClient();

  // ── GET: fetch scores for a judge ────────────────────────────────
  if (req.method === 'GET') {
    const { hub, code } = req.query;
    if (!PRIZE_HUBS.includes(hub)) return res.status(400).json({ error: 'Invalid hub' });

    const judge = await validateJudgeCode(supabase, code, hub);
    if (!judge) return res.status(403).json({ error: 'Invalid judge code for this hub' });

    const { data: scores, error } = await supabase
      .from('judge_scores')
      .select('team_id, criterion_1, criterion_2, criterion_3, notes, updated_at')
      .eq('judge_id', code)
      .eq('hub', hub);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      judgeLabel: judge.label,
      hub,
      scores: (scores || []).map(s => ({
        teamId: s.team_id,
        c1: s.criterion_1,
        c2: s.criterion_2,
        c3: s.criterion_3,
        total: (s.criterion_1 || 0) + (s.criterion_2 || 0) + (s.criterion_3 || 0),
        notes: s.notes,
        updatedAt: s.updated_at,
      })),
    });
  }

  // ── POST: save scores ────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { hub, judgeCode, scores } = req.body || {};

  if (!PRIZE_HUBS.includes(hub)) return res.status(400).json({ error: 'Invalid hub' });
  if (!Array.isArray(scores) || scores.length === 0) return res.status(400).json({ error: 'scores array required' });

  const judge = await validateJudgeCode(supabase, judgeCode, hub);
  if (!judge) return res.status(403).json({ error: 'Invalid judge code for this hub' });

  // Upsert all scores
  const rows = scores.map(s => ({
    judge_id:    judgeCode,
    team_id:     s.teamId,
    hub,
    criterion_1: s.c1 !== undefined ? Number(s.c1) : null,
    criterion_2: s.c2 !== undefined ? Number(s.c2) : null,
    criterion_3: s.c3 !== undefined ? Number(s.c3) : null,
    notes:       s.notes || null,
    updated_at:  new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('judge_scores')
    .upsert(rows, { onConflict: 'judge_id,team_id' });

  if (error) {
    console.error('[judge-score] upsert error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.json({ ok: true, saved: rows.length });
};
