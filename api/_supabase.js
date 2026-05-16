// Supabase REST client — native fetch, zero npm dependencies.
// Tested on Node 24 / Vercel serverless.

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

  const REST = `${url}/rest/v1`;
  const BASE_HEADERS = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  async function req(method, path, { params = {}, body, prefer } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach(vi => qs.append(k, vi));
      else qs.append(k, v);
    }
    const qstr = qs.toString();
    const fullUrl = `${REST}/${path}${qstr ? '?' + qstr : ''}`;

    const headers = { ...BASE_HEADERS };
    if (prefer) headers['Prefer'] = prefer;

    const res = await fetch(fullUrl, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      return { data: null, error: { message: msg, status: res.status, details: data } };
    }
    return { data, error: null };
  }

  // ── from() — chainable query builder ─────────────────────────────
  function from(table) {
    const _params = {};
    let _single = false;

    function set(key, val) {
      if (_params[key] === undefined) _params[key] = val;
      else if (Array.isArray(_params[key])) _params[key].push(val);
      else _params[key] = [_params[key], val];
    }

    const b = {
      select(cols = '*') { _params.select = cols; return b; },
      eq(col, val)  { set(col, `eq.${val}`);                                   return b; },
      neq(col, val) { set(col, `neq.${val}`);                                  return b; },
      gt(col, val)  { set(col, `gt.${val}`);                                   return b; },
      gte(col, val) { set(col, `gte.${val}`);                                  return b; },
      in(col, vals) { set(col, `in.(${vals.join(',')})`);                      return b; },
      order(col, { ascending = true } = {}) { _params.order = `${col}.${ascending ? 'asc' : 'desc'}`; return b; },
      limit(n)   { _params.limit  = String(n); return b; },
      single()   { _single = true; return b; },

      // Make it awaitable
      then(resolve, reject) {
        if (!_params.select) _params.select = '*';
        const prefer = _single
          ? 'return=representation'
          : undefined;
        const headers_override = _single
          ? { ...BASE_HEADERS, 'Accept': 'application/vnd.pgrst.object+json' }
          : undefined;

        // Build params object for URLSearchParams
        const p = { ..._params };

        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(p)) {
          if (Array.isArray(v)) v.forEach(vi => qs.append(k, vi));
          else qs.append(k, v);
        }

        const fullUrl = `${REST}/${table}?${qs.toString()}`;
        const h = headers_override || { ...BASE_HEADERS };

        fetch(fullUrl, { method: 'GET', headers: h })
          .then(async res => {
            const text = await res.text();
            const data = text ? JSON.parse(text) : null;
            if (!res.ok) {
              resolve({ data: null, error: { message: data?.message || `HTTP ${res.status}`, status: res.status } });
            } else {
              resolve({ data, error: null });
            }
          })
          .catch(reject);
      },
    };

    return b;
  }

  return {
    from,

    // ── INSERT ──────────────────────────────────────────────────────
    async insert(table, rows) {
      return req('POST', table, {
        body: Array.isArray(rows) ? rows : [rows],
        prefer: 'return=representation',
      });
    },

    // ── UPSERT ──────────────────────────────────────────────────────
    async upsert(table, rows, { onConflict } = {}) {
      const path = onConflict ? `${table}?on_conflict=${onConflict}` : table;
      return req('POST', path, {
        body: Array.isArray(rows) ? rows : [rows],
        prefer: 'resolution=merge-duplicates,return=representation',
      });
    },

    // ── UPDATE ──────────────────────────────────────────────────────
    async updateWhere(table, updates, filters = {}) {
      const params = {};
      for (const [k, v] of Object.entries(filters)) params[k] = `eq.${v}`;
      return req('PATCH', table, { params, body: updates, prefer: 'return=representation' });
    },

    // ── DELETE ──────────────────────────────────────────────────────
    async deleteWhere(table, filters = {}) {
      const params = {};
      for (const [k, v] of Object.entries(filters)) params[k] = `eq.${v}`;
      return req('DELETE', table, { params });
    },

    // ── RPC ─────────────────────────────────────────────────────────
    async rpc(fn, args = {}) {
      return req('POST', `rpc/${fn}`, { body: args, prefer: 'return=representation' });
    },
  };
}

module.exports = { getClient };
