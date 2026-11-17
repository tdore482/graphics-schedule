const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

let serviceAccountCache;
let db;

function normalizeKey(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function parseServiceAccount() {
  if (serviceAccountCache !== undefined) return serviceAccountCache;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json && json.trim()) {
    try {
      const parsed = JSON.parse(json);
      serviceAccountCache = {
        projectId: parsed.project_id || parsed.projectId,
        clientEmail: parsed.client_email || parsed.clientEmail,
        privateKey: normalizeKey(parsed.private_key || parsed.privateKey)
      };
      return serviceAccountCache;
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    serviceAccountCache = null;
    return null;
  }
  serviceAccountCache = { projectId, clientEmail, privateKey: normalizeKey(privateKey) };
  return serviceAccountCache;
}

function isFirestoreConfigured() {
  return !!parseServiceAccount();
}

function getDb() {
  if (!isFirestoreConfigured()) return null;
  let app = admin.getApps()[0];
  if (!app) {
    app = admin.initializeApp({ credential: admin.cert(parseServiceAccount()) });
  }
  if (!db) {
    const databaseId = process.env.FIRESTORE_DATABASE_ID;
    db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
  return db;
}

module.exports = { isFirestoreConfigured, getDb };
