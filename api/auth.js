const crypto = require('crypto');
const store = require('../lib/store');
const http = require('../lib/http');
const auth = require('../lib/auth');
const validate = require('../lib/validate');
const email = require('../lib/email');

function rosterUserId(entry) {
  return entry && typeof entry === 'object' ? entry.userId : null;
}

function rosterName(entry) {
  return typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? entry.name : '';
}

async function addToRoster(user) {
  const schedule = await store.read('schedule');
  const roster = Array.isArray(schedule.roster) ? schedule.roster : [];
  const exists = roster.some(e => rosterUserId(e) === user.id || String(rosterName(e)).toLowerCase() === user.name.toLowerCase());
  if (!exists) {
    roster.push({ userId: user.id, name: user.name });
    schedule.roster = roster;
    await store.write('schedule', schedule);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let data;
  try {
    data = await auth.ensureSeed();
  } catch (e) {
    return http.send(res, 500, { error: 'Unable to load accounts.' });
  }

  if (req.method === 'GET') {
    const user = auth.currentUser(req, data);
    return http.send(res, 200, {
      user: auth.publicUser(user),
      users: user && user.role === 'admin' ? data.users.map(auth.publicUser) : []
    });
  }
  if (req.method !== 'POST') return http.send(res, 405, { error: 'Method not allowed.' });

  let body;
  try { body = await http.readBody(req); }
  catch (e) { return http.send(res, 400, { error: 'Invalid request.' }); }

  try {
    if (body.action === 'login') {
      const mail = validate.email(body.email);
      const pass = typeof body.password === 'string' ? body.password : '';
      if (!mail || !pass) return http.send(res, 400, { error: 'Enter your email and password.' });
      const now = Date.now();
      const key = mail;
      const attempt = data.loginAttempts[key] && typeof data.loginAttempts[key] === 'object' ? data.loginAttempts[key] : { count: 0, firstAt: now };
      if (now - Number(attempt.firstAt || now) > 15 * 60000) { attempt.count = 0; attempt.firstAt = now; }
      if (Number(attempt.count || 0) >= 8) return http.send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      const user = data.users.find(u => u.email === mail && u.active);
      if (!user || !auth.verifyPassword(pass, user)) {
        data.loginAttempts[key] = { count: Number(attempt.count || 0) + 1, firstAt: attempt.firstAt || now };
        await auth.saveAuth(data);
        return http.send(res, 401, { error: 'Incorrect email or password.' });
      }
      delete data.loginAttempts[key];
      await auth.startSession(res, data, user.id);
      return http.send(res, 200, { user: auth.publicUser(user) });
    }

    if (body.action === 'logout') {
      await auth.endSession(req, res, data);
      return http.send(res, 200, { ok: true });
    }

    if (body.action === 'change-password') {
      const user = auth.requireUser(req, res, data);
      if (!user) return;
      if (!auth.verifyPassword(body.current, user)) return http.send(res, 401, { error: 'Current password is incorrect.' });
      const next = validate.password(body.next);
      if (!next) return http.send(res, 400, { error: 'New password must be at least 8 characters.' });
      const { salt, hash } = auth.hashPassword(next);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      await auth.saveAuth(data);
      return http.send(res, 200, { ok: true });
    }

    if (body.action === 'create-user') {
      const admin = auth.requireAdmin(req, res, data);
      if (!admin) return;
      const result = await auth.createUser(data, body);
      if (result.error) return http.send(res, 400, { error: result.error });
      await auth.saveAuth(data);
      await addToRoster(result.user);
      const tempPassword = validate.text(body.password, 200);
      const sent = await email.sendEmail(
        result.user.email,
        'Your Graphics Scheduler account',
        `Hello ${result.user.name},\n\nAn account has been created for you on Graphics Scheduler.\n\nEmail: ${result.user.email}\nTemporary password: ${tempPassword}\n\nPlease sign in and change your password.\n\n${process.env.APP_URL || ''}`
      );
      return http.send(res, 200, { user: auth.publicUser(result.user), warning: sent.ok ? '' : 'Account created, but the welcome email could not be sent.' });
    }

    return http.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('auth action failed:', e && e.message ? e.message : e);
    return http.send(res, 500, { error: 'Unable to complete the request.' });
  }
};
