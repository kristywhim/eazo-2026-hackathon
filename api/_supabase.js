// Shared Supabase client for all API functions
// Env vars set in Vercel dashboard (or .env.local for dev):
//   SUPABASE_URL          — your project URL
//   SUPABASE_SERVICE_KEY  — service role key (bypasses RLS; never expose to frontend)

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    _client = createClient(url, key);
  }
  return _client;
}

module.exports = { getClient };
