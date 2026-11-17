const crypto = require('crypto');
const { get, put } = require('@vercel/blob');

const PATH = 'schedule.json';
const DEFAULT_PIN = process.env.ADMIN_PIN || '1234';
const hashPin = pin => crypto.createHash('sha256').update(String(pin)).digest('hex');

function cleanRoster(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const name = String(item || '').trim().slice(0, 80);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) { seen.add(key); out.push(name); }
  }
  return out.slice(0, 50);
}

function cleanDone(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, val] of Object.entries(value)) {
    if (typeof key === 'string' && key.length <= 100 && val === true) out[key] = true;
  }
  return out;
}

function normalize(value) {
  const data = value && typeof value === 'object' ? value : {};
  return {
    roster: cleanRoster(data.roster),
    done: cleanDone(data.done),
    salt: Number.isFinite(data.salt) ? data.salt >>> 0 : 0,
    pinHash: typeof data.pinHash === 'string' && data.pinHash.length === 64 ? data.pinHash : hashPin(DEFAULT_PIN)
  };
}

function publicState(state) {
  return { roster: state.roster, done: state.done, salt: state.salt };
}

async function readState() {
  const result = await get(PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return normalize(null);
  const text = await new Response(result.stream).text();
  try { return normalize(JSON.parse(text)); } catch (e) { return normalize(null); }
}

async function writeState(state) {
  await put(PATH, JSON.stringify(state), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    try { return send(res, 200, publicState(await readState())); }
    catch (e) { return send(res, 500, { error: 'Unable to load schedule' }); }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readBody(req); }
  catch (e) { return send(res, 400, { error: 'Invalid request' }); }

  try {
    const state = await readState();

    if (body.action === 'done') {
      const key = typeof body.key === 'string' ? body.key : '';
      if (!key || key.length > 100) return send(res, 400, { error: 'Invalid item' });
      if (body.value === true) state.done[key] = true;
      else delete state.done[key];
      await writeState(state);
      return send(res, 200, publicState(state));
    }

    if (body.action === 'verify') {
      const ok = hashPin(body.pin) === state.pinHash;
      return send(res, ok ? 200 : 401, ok ? { ok: true } : { error: 'Incorrect PIN' });
    }

    if (body.action === 'admin') {
      if (hashPin(body.pin) !== state.pinHash) return send(res, 401, { error: 'Incorrect PIN' });
      state.roster = cleanRoster(body.roster);
      state.salt = Number.isFinite(body.salt) ? body.salt >>> 0 : 0;
      await writeState(state);
      return send(res, 200, publicState(state));
    }

    if (body.action === 'clear') {
      if (hashPin(body.pin) !== state.pinHash) return send(res, 401, { error: 'Incorrect PIN' });
      state.done = {};
      await writeState(state);
      return send(res, 200, publicState(state));
    }

    if (body.action === 'pin') {
      if (hashPin(body.current) !== state.pinHash) return send(res, 401, { error: 'Current PIN is incorrect' });
      const next = typeof body.next === 'string' ? body.next.trim() : '';
      if (!next) return send(res, 400, { error: 'Enter a new PIN' });
      state.pinHash = hashPin(next);
      await writeState(state);
      return send(res, 200, publicState(state));
    }

    return send(res, 400, { error: 'Unknown action' });
  } catch (e) {
    console.error('schedule update failed:', e && e.message ? e.message : e);
    return send(res, 500, { error: 'Unable to save schedule' });
  }
};
