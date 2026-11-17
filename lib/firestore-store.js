const { getDb } = require('./firebase');

function collection() {
  const db = getDb();
  if (!db) throw new Error('Firestore is not configured.');
  return db.collection(process.env.FIRESTORE_COLLECTION || 'app_state');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function has(name) {
  const snap = await collection().doc(name).get();
  return snap.exists;
}

async function read(name, fallback) {
  const snap = await collection().doc(name).get();
  if (!snap.exists) return fallback;
  const data = snap.data() || {};
  const value = Object.prototype.hasOwnProperty.call(data, 'value') ? data.value : data;
  return value && typeof value === 'object' ? value : fallback;
}

async function write(name, value) {
  await collection().doc(name).set({ value: clone(value), updatedAt: new Date().toISOString() });
}

module.exports = { has, read, write };
