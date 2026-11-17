const crypto = require('crypto');
const store = require('./store');
const http = require('./http');
const validate = require('./validate');

const COOKIE = 'gs_session';
const SESSION_DAYS = 7;

function normalizeAuth(value) {
  const data = value && typeof value === 'object' ? value : {};
  const users = Array.isArray(data.users) ? data.users : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const attempts = data.loginAttempts && typeof data.loginAttempts === 'object' && !Array.isArray(data.loginAttempts) ? data.loginAttempts : {};
  const seen = new Set();
  return {
    users: users.map(u => {
      const raw = u && typeof u === 'object' ? u : {};
      const email = validate.email(raw.email);
      if (!email || seen.has(email)) return null;
      seen.add(email);
      return {
        id: validate.text(raw.id, 80) || crypto.randomUUID(),
        name: validate.text(raw.name, 80) || email.split('@')[0],
        email,
        role: raw.role === 'admin' ? 'admin' : 'designer',
        active: raw.active !== false,
        passwordHash: validate.text(raw.passwordHash, 200),
        passwordSalt: validate.text(raw.passwordSalt, 100),
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
      };
    }).filter(Boolean),
    sessions: sessions.map(s => {
      const raw = s && typeof s === 'object' ? s : {};
      const tokenHash = validate.text(raw.tokenHash, 100);
      return tokenHash ? {
        tokenHash,
        userId: validate.text(raw.userId, 80),
        expiresAt: Number.isFinite(raw.expiresAt) ? raw.expiresAt : 0
      } : null;
    }).filter(Boolean),
    loginAttempts: attempts
  };
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  return { salt: s, hash: crypto.scryptSync(String(password), s, 64).toString('hex') };
}

function verifyPassword(password, user) {
  if (!user || !user.passwordHash || !user.passwordSalt) return false;
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = crypto.scryptSync(String(password), user.passwordSalt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function loadAuth() {
  return normalizeAuth(await store.read('auth'));
}

async function ensureSeed() {
  const auth = await loadAuth();
  if (auth.users.some(u => u.role === 'admin')) return auth;
  const email = validate.email(process.env.ADMIN_EMAIL) || 'admin@graphics.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const { salt, hash } = hashPassword(password);
  auth.users.push({
    id: crypto.randomUUID(),
    name: 'Administrator',
    email,
    role: 'admin',
    active: true,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: Date.now()
  });
  await store.write('auth', auth);
  return auth;
}

async function saveAuth(auth) {
  await store.write('auth', normalizeAuth(auth));
}

async function createUser(auth, fields) {
  const name = validate.text(fields.name, 80);
  const mail = validate.email(fields.email);
  const pass = validate.password(fields.password);
  if (!name || !mail || !pass) return { error: 'Name, a valid email, and a password of at least 8 characters are required.' };
  if (auth.users.some(u => u.email === mail)) return { error: 'An account with that email already exists.' };
  const { salt, hash } = hashPassword(pass);
  const user = {
    id: crypto.randomUUID(),
    name,
    email: mail,
    role: fields.role === 'admin' ? 'admin' : 'designer',
    active: true,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: Date.now()
  };
  auth.users.push(user);
  return { user };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function startSession(res, auth, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  auth.sessions = auth.sessions.filter(s => s.expiresAt > Date.now());
  auth.sessions.push({ tokenHash: hashToken(token), userId, expiresAt: Date.now() + SESSION_DAYS * 86400000 });
  await saveAuth(auth);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  return token;
}

async function endSession(req, res, auth) {
  const token = http.parseCookies(req)[COOKIE];
  if (token) auth.sessions = auth.sessions.filter(s => s.tokenHash !== hashToken(token));
  await saveAuth(auth);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function currentUser(req, auth) {
  const token = http.parseCookies(req)[COOKIE];
  if (!token) return null;
  const hash = hashToken(token);
  const session = auth.sessions.find(s => s.tokenHash === hash && s.expiresAt > Date.now());
  if (!session) return null;
  const user = auth.users.find(u => u.id === session.userId && u.active);
  return user || null;
}

function requireUser(req, res, auth) {
  const user = currentUser(req, auth);
  if (!user) http.send(res, 401, { error: 'Please sign in.' });
  return user;
}

function requireAdmin(req, res, auth) {
  const user = requireUser(req, res, auth);
  if (!user) return null;
  if (user.role !== 'admin') {
    http.send(res, 403, { error: 'Admin access required.' });
    return null;
  }
  return user;
}

module.exports = {
  COOKIE,
  normalizeAuth,
  hashPassword,
  verifyPassword,
  publicUser,
  loadAuth,
  ensureSeed,
  saveAuth,
  createUser,
  startSession,
  endSession,
  currentUser,
  requireUser,
  requireAdmin
};
