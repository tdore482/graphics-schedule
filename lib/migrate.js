const blob = require('./blob-store');
const firestore = require('./firestore-store');
const { isFirestoreConfigured } = require('./firebase');

let migrationPromise;

async function migrateFromBlob() {
  if (!isFirestoreConfigured()) return { ok: false, skipped: 'Firestore is not configured.' };
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { ok: false, skipped: 'Blob token is not configured.' };

  const migrated = [];
  const existing = [];
  for (const name of Object.keys(blob.KEYS)) {
    if (await firestore.has(name)) {
      existing.push(name);
      continue;
    }
    const value = await blob.read(name);
    await firestore.write(name, value);
    migrated.push(name);
  }
  return { ok: true, migrated, existing };
}

function ensureMigrated() {
  if (!migrationPromise) {
    migrationPromise = migrateFromBlob().catch(e => {
      migrationPromise = undefined;
      throw e;
    });
  }
  return migrationPromise;
}

module.exports = { migrateFromBlob, ensureMigrated };
