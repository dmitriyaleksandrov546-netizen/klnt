// Vercel serverless function: proxy /api/bookbot/* to BookBot VDS API
// Adds proxy-secret header from env, forwards initData header from client.
// Passes the request body as RAW BYTES so multipart uploads (audio) survive.
//
// Env vars (set in Vercel project settings):
//   BOOKBOT_API_URL    — e.g. http://213.239.157.13:8787
//   BOOKBOT_PROXY_SECRET — same value as on the VDS

// Disable Vercel's built-in body parser so multipart (audio uploads) doesn't get mangled.
export const config = {
  api: { bodyParser: false },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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
  const { path: _omit, ...rest } = req.query;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v != null) qs.append(k, v);
  }
  const qsStr = qs.toString();
  const url = `${base.replace(/\/$/, '')}/api/${path}${qsStr ? `?${qsStr}` : ''}`;

  // Сохраняем оригинальный content-type (с boundary для multipart!) и Telegram initData.
  const headers = {
    'X-Telegram-Init-Data': req.headers['x-telegram-init-data'] || '',
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (secret) headers['X-Proxy-Secret'] = secret;

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    body = await readRawBody(req);
    if (body.length === 0) body = undefined;
  }

  try {
    const upstream = await fetch(url, { method: req.method, headers, body });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: 'upstream_fetch_failed', detail: String(e) });
  }
}
