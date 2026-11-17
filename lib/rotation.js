const { POSTERS } = require('./validate');

const EPOCH = Date.UTC(1970, 0, 1);

function rosterName(entry) {
  if (typeof entry === 'string') return entry;
  return entry && typeof entry === 'object' ? String(entry.name || '') : '';
}

function hash32(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}

function weekIndex(date) {
  return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - EPOCH) / 604800000);
}

function baseFor(names, salt, w) {
  const n = names.length;
  if (!n) return 0;
  const raw = i => hash32(salt ^ i) % n;
  let b = raw(0);
  const dir = w > 0 ? 1 : -1;
  for (let i = dir; i !== w + dir; i += dir) {
    let r = raw(i);
    if (r === b) r = (r + 1) % n;
    b = r;
  }
  return b;
}

function assignments(roster, salt, thursday) {
  const names = (Array.isArray(roster) ? roster : []).map(rosterName).filter(Boolean);
  if (!names.length) return POSTERS.map(() => null);
  const b = baseFor(names, salt >>> 0, weekIndex(thursday));
  return POSTERS.map((poster, i) => ({ poster, name: names[(b + i) % names.length] }));
}

function thursdayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const shift = (4 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + shift);
  return d;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function weekKeyFor(date) {
  return ymd(thursdayOf(date || new Date()));
}

module.exports = { POSTERS, rosterName, weekIndex, assignments, thursdayOf, ymd, weekKeyFor };
