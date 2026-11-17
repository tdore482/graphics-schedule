const crypto = require('crypto');
const store = require('../lib/store');
const http = require('../lib/http');
const auth = require('../lib/auth');
const validate = require('../lib/validate');

function normalizeEvents(value) {
  return (Array.isArray(value) ? value : []).map(v => {
    const event = validate.cleanEvent(v);
    return event && event.title ? event : null;
  }).filter(Boolean).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let account, events;
  try {
    [account, events] = await Promise.all([auth.loadAuth(), store.read('events')]);
  } catch (e) {
    return http.send(res, 500, { error: 'Unable to load events.' });
  }
  const user = auth.currentUser(req, account);
  const all = normalizeEvents(events);

  if (req.method === 'GET') {
    return http.send(res, 200, {
      events: all,
      user: auth.publicUser(user),
      canManage: !!user && user.role === 'admin'
    });
  }
  if (req.method !== 'POST') return http.send(res, 405, { error: 'Method not allowed.' });

  let body;
  try { body = await http.readBody(req); }
  catch (e) { return http.send(res, 400, { error: 'Invalid request.' }); }

  try {
    const admin = auth.requireAdmin(req, res, account);
    if (!admin) return;
    const cleaned = validate.cleanEvent(body);
    if (!cleaned || !cleaned.title || !cleaned.startsAt) return http.send(res, 400, { error: 'A title and start date are required.' });

    if (body.action === 'delete') {
      const id = validate.text(body.id, 80);
      const next = all.filter(e => e.id !== id);
      if (next.length === all.length) return http.send(res, 404, { error: 'Event not found.' });
      await store.write('events', next);
      return http.send(res, 200, { ok: true });
    }

    if (body.action === 'save') {
      cleaned.id = cleaned.id || crypto.randomUUID();
      const index = all.findIndex(e => e.id === cleaned.id);
      if (index >= 0) all[index] = cleaned; else all.push(cleaned);
      await store.write('events', normalizeEvents(all));
      return http.send(res, 200, { ok: true });
    }

    return http.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('event action failed:', e && e.message ? e.message : e);
    return http.send(res, 500, { error: 'Unable to save event.' });
  }
};
