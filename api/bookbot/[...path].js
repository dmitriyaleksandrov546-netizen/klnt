// Vercel serverless function: proxy /api/bookbot/* to BookBot VDS API
// Adds proxy-secret header from env, forwards initData header from client.
//
// Env vars (set in Vercel project settings):
//   BOOKBOT_API_URL    — e.g. http://213.239.157.13:8787
//   BOOKBOT_PROXY_SECRET — same value as on the VDS

export default async function handler(req, res) {
  // CORS — открыт для Mini App с любого хоста (github.io, vercel preview, etc.)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const base = process.env.BOOKBOT_API_URL;
  const secret = process.env.BOOKBOT_PROXY_SECRET;
  if (!base) {
    res.status(500).json({ error: 'BOOKBOT_API_URL not configured' });
    return;
  }
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : (req.query.path || '');
  // Сохраняем query string (без `path` параметра Vercel)
  const { path: _omit, ...rest } = req.query;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x));
    else if (v != null) qs.append(k, v);
  }
  const qsStr = qs.toString();
  const url = `${base.replace(/\/$/, '')}/api/${path}${qsStr ? `?${qsStr}` : ''}`;

  const headers = {
    'Content-Type': req.headers['content-type'] || 'application/json',
    'X-Telegram-Init-Data': req.headers['x-telegram-init-data'] || '',
  };
  if (secret) headers['X-Proxy-Secret'] = secret;

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    // Vercel parses JSON body automatically; re-serialize
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }

  try {
    const upstream = await fetch(url, { method: req.method, headers, body });
    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'upstream_fetch_failed', detail: String(e) });
  }
}
