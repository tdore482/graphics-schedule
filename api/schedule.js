const store = require('../lib/store');
const http = require('../lib/http');
const auth = require('../lib/auth');
const validate = require('../lib/validate');
const { POSTERS, rosterName } = require('../lib/rotation');

function validItemKey(key) {
  const [date, poster] = String(key || '').split('|');
  return !!validate.weekKey(date) && POSTERS.includes(poster);
}

function normalizeSchedule(value) {
  const data = value && typeof value === 'object' ? value : {};
  const roster = Array.isArray(data.roster) ? data.roster : [];
  const seen = new Set();
  const cleanRoster = roster.map(entry => {
    const name = validate.text(rosterName(entry), 80);
    if (!name) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    if (typeof entry === 'string') return { userId: null, name, legacy: true };
    return { userId: validate.text(entry.userId, 80) || null, name };
  }).filter(Boolean).slice(0, 50);
  const done = {};
  if (data.done && typeof data.done === 'object' && !Array.isArray(data.done)) {
    for (const [key, val] of Object.entries(data.done)) {
      if (typeof key === 'string' && key.length <= 100 && val === true) done[key] = true;
    }
  }
  const descriptions = {};
  if (data.descriptions && typeof data.descriptions === 'object' && !Array.isArray(data.descriptions)) {
    for (const [key, val] of Object.entries(data.descriptions)) {
      const note = validate.text(val, 240);
      if (validItemKey(key) && note) descriptions[key] = note;
    }
  }
  return { roster: cleanRoster, done, descriptions, salt: Number.isFinite(data.salt) ? data.salt >>> 0 : 0 };
}

function publicState(schedule, user) {
  return {
    roster: schedule.roster,
    done: schedule.done,
    descriptions: schedule.descriptions,
    salt: schedule.salt,
    user: auth.publicUser(user),
    canManage: !!user && user.role === 'admin'
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let account, schedule;
  try {
    [account, schedule] = await Promise.all([auth.loadAuth(), store.read('schedule')]);
  } catch (e) {
    return http.send(res, 500, { error: 'Unable to load schedule.' });
  }
  const user = auth.currentUser(req, account);
  const state = normalizeSchedule(schedule);

  if (req.method === 'GET') return http.send(res, 200, publicState(state, user));
  if (req.method !== 'POST') return http.send(res, 405, { error: 'Method not allowed.' });

  let body;
  try { body = await http.readBody(req); }
  catch (e) { return http.send(res, 400, { error: 'Invalid request.' }); }

  try {
    if (body.action === 'done') {
      const editor = auth.requireAdmin(req, res, account);
      if (!editor) return;
      const key = validate.text(body.key, 100);
      if (!validItemKey(key)) return http.send(res, 400, { error: 'Invalid item.' });
      if (body.value === true) state.done[key] = true;
      else delete state.done[key];
      await store.write('schedule', state);
      return http.send(res, 200, publicState(state, editor));
    }

    if (body.action === 'description') {
      const admin = auth.requireAdmin(req, res, account);
      if (!admin) return;
      const key = validate.text(body.key, 100);
      if (!validItemKey(key)) return http.send(res, 400, { error: 'Invalid item.' });
      const note = validate.text(body.value, 240);
      if (note) state.descriptions[key] = note;
      else delete state.descriptions[key];
      await store.write('schedule', state);
      return http.send(res, 200, publicState(state, admin));
    }

    const admin = auth.requireAdmin(req, res, account);
    if (!admin) return;

    if (body.action === 'remove-from-roster') {
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.roster.length) return http.send(res, 400, { error: 'Invalid designer.' });
      state.roster.splice(index, 1);
      await store.write('schedule', state);
      return http.send(res, 200, publicState(state, admin));
    }

    if (body.action === 'shuffle') {
      state.salt = (state.salt + 1) >>> 0;
      await store.write('schedule', state);
      return http.send(res, 200, publicState(state, admin));
    }

    if (body.action === 'clear') {
      state.done = {};
      await store.write('schedule', state);
      return http.send(res, 200, publicState(state, admin));
    }

    return http.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('schedule update failed:', e && e.message ? e.message : e);
    return http.send(res, 500, { error: 'Unable to save schedule.' });
  }
};
