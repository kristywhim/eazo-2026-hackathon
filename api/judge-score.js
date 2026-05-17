// POST /api/judge-score
// Submit or update judge scores for finalist teams.
// Rubric: 5 dimensions × 10 pts each = 50 pts/judge (per Eazo Judge Guide 2026)
//
// Body: { hub, judgeCode, scores: [{ teamId, completeness, innovation, technical, design, commercial, notes }] }
// Response: { ok: true, saved: number }
//
// GET /api/judge-score?hub=sf&code=JUDGE_SF_01
// Response: { scores: [{ teamId, completeness, innovation, technical, design, commercial, total, notes }] }

const { getClient } = require('./_supabase');

const PRIZE_HUBS = ['sf', 'ny', 'sh'];

const CRITERIA = ['completeness', 'innovation', 'technical', 'design', 'commercial'];

// Clamp + coerce to 0..10, or null if not provided
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
      .select('team_id, completeness, innovation, technical, design, commercial, notes, updated_at')
      .eq('judge_id', code)
      .eq('hub', hub);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      judgeLabel: judge.label,
      hub,
      scores: (scores || []).map(s => ({
        teamId:       s.team_id,
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

  // ── POST: save scores ────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { hub, judgeCode, scores } = req.body || {};

  if (!PRIZE_HUBS.includes(hub)) return res.status(400).json({ error: 'Invalid hub' });
  if (!Array.isArray(scores) || scores.length === 0) return res.status(400).json({ error: 'scores array required' });

  const judge = await validateJudgeCode(supabase, judgeCode, hub);
  if (!judge) return res.status(403).json({ error: 'Invalid judge code for this hub' });

  // Upsert all scores
  const rows = scores.map(s => ({
    judge_id:     judgeCode,
    team_id:      s.teamId,
    hub,
    completeness: clamp10(s.completeness),
    innovation:   clamp10(s.innovation),
    technical:    clamp10(s.technical),
    design:       clamp10(s.design),
    commercial:   clamp10(s.commercial),
    notes:        s.notes || null,
    updated_at:   new Date().toISOString(),
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
