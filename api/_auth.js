// Validates the Eazo app auth token passed via WebView bridge
// Token is a JWT signed by Eazo — we verify it using the Eazo public key.
//
// ⚠️  PENDING: Need from Eazo team:
//   1. JWT signing algorithm (RS256 / HS256 / ES256?)
//   2. Public key or shared secret for verification
//   3. Token payload fields (which field contains user_id? team_id? hub?)
//
// Until then: this file accepts a mock token for local dev
// and fails open with a warning in production.

const EAZO_JWT_SECRET = process.env.EAZO_JWT_SECRET || null;

/**
 * Extract and verify user identity from request.
 * Token passed as: Authorization: Bearer <token>
 *
 * Returns: { userId, teamId, hub } or throws 401.
 */
async function requireAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) throw { status: 401, message: 'Missing auth token' };

  // ── DEV MODE: accept plain JSON base64 mock token ──────────────
  // Format: base64(JSON.stringify({ userId, teamId, hub }))
  if (process.env.NODE_ENV !== 'production') {
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
      if (payload.userId) return payload;
    } catch (_) {}
  }

  // ── PRODUCTION: verify JWT with Eazo secret ────────────────────
  // TODO: swap for real JWT verification once Eazo provides key
  // Example with jsonwebtoken:
  //   const jwt = require('jsonwebtoken');
  //   const decoded = jwt.verify(token, EAZO_JWT_SECRET, { algorithms: ['HS256'] });
  //   return { userId: decoded.sub, teamId: decoded.team_id, hub: decoded.hub };

  if (!EAZO_JWT_SECRET) {
    // Fail open in dev/staging until key is provided — log a warning
    console.warn('[auth] EAZO_JWT_SECRET not set — accepting unverified token');
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        return { userId: payload.sub || payload.user_id, teamId: payload.team_id, hub: payload.hub };
      }
    } catch (_) {}
  }

  throw { status: 401, message: 'Invalid or unverifiable token' };
}

/**
 * Lightweight hub validation.
 */
function validHub(hub) {
  return ['sf','ny','sh','go','ao'].includes(hub);
}

module.exports = { requireAuth, validHub };
