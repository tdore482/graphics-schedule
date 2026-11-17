const blob = require('./blob-store');
const firestore = require('./firestore-store');
const { isFirestoreConfigured } = require('./firebase');
const { ensureMigrated, migrateFromBlob } = require('./migrate');

const KEYS = blob.KEYS;
const backend = isFirestoreConfigured() ? 'firestore' : 'blob';

async function read(name) {
  const fallback = blob.DEFAULTS[name]();
  if (backend === 'blob') return blob.read(name);
  try {
    await ensureMigrated();
    return await firestore.read(name, fallback);
  } catch (e) {
    console.error('firestore read failed for ' + name + ':', e && e.stack ? e.stack : e);
    throw e;
  }
}

async function write(name, value) {
  if (backend === 'blob') return blob.write(name, value);
  try {
    await ensureMigrated();
    return await firestore.write(name, value);
  } catch (e) {
    console.error('firestore write failed for ' + name + ':', e && e.stack ? e.stack : e);
    throw e;
  }
}

module.exports = { KEYS, backend, read, write, migrateFromBlob };
