// GET /api/deadlines
// Public read endpoint — returns canonical hackathon deadlines as JSON.
// Frontend HTML pages fetch this on load and override their inline constants
// so a single edit in api/_deadlines.js propagates everywhere.

const { SUBMISSION_DEADLINES, VOTING_DEADLINES } = require('./_deadlines');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // 1-hour CDN cache; deadlines almost never change once set
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  return res.json({
    submission: SUBMISSION_DEADLINES,
    voting:     VOTING_DEADLINES,
  });
};
