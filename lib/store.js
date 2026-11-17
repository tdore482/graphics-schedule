const { get, put } = require('@vercel/blob');

const KEYS = {
  auth: 'auth.json',
  schedule: 'schedule.json',
  submissions: 'submissions.json',
  events: 'events.json',
  mail: 'mail-state.json'
};

const DEFAULTS = {
  auth: () => ({ users: [], sessions: [], loginAttempts: {} }),
  schedule: () => ({ roster: [], done: {}, salt: 0 }),
  submissions: () => [],
  events: () => [],
  mail: () => ({ sent: {} })
};

function isMissing(e) {
  return !!e && (e.status === 404 || e.statusCode === 404 || e.name === 'BlobNotFoundError' || /not found/i.test(String(e.message || '')));
}

async function read(name) {
  const fallback = DEFAULTS[name]();
  let result;
  try {
    result = await get(KEYS[name], { access: 'private', useCache: false });
  } catch (e) {
    if (isMissing(e)) return fallback;
    throw e;
  }
  if (!result || result.statusCode !== 200 || !result.stream) return fallback;
  const text = await new Response(result.stream).text();
  if (!text.trim()) return fallback;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : fallback;
  } catch (e) {
    return fallback;
  }
}

async function write(name, value) {
  await put(KEYS[name], JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
}

module.exports = { KEYS, read, write };
