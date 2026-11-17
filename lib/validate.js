const POSTERS = ['BT-MGS', 'BT-GDADM', 'KMZ'];

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 120);
}

function email(value) {
  const v = text(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

function password(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 200 ? value : '';
}

function weTransferUrl(value) {
  const v = text(value, 500);
  let u;
  try { u = new URL(v); } catch (e) { return ''; }
  if (u.protocol !== 'https:') return '';
  const host = u.hostname.toLowerCase();
  if (host !== 'we.tl' && host !== 'wetransfer.com' && !host.endsWith('.wetransfer.com')) return '';
  return u.toString();
}

function weekKey(value) {
  const v = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return '';
  return d.getUTCDay() === 4 ? v : '';
}

function cleanEvent(value) {
  const data = value && typeof value === 'object' ? value : {};
  const startsAt = text(data.startsAt, 40);
  const endsAt = text(data.endsAt, 40);
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  if (!start || isNaN(start.getTime())) return null;
  if (end && isNaN(end.getTime())) return null;
  if (end && end.getTime() < start.getTime()) return null;
  return {
    id: text(data.id, 80),
    title: text(data.title, 140),
    startsAt: start.toISOString(),
    endsAt: end ? end.toISOString() : '',
    location: text(data.location, 140),
    description: text(data.description, 1200),
    link: /^https:\/\//i.test(text(data.link, 500)) ? text(data.link, 500) : ''
  };
}

function cleanSubmission(value) {
  const data = value && typeof value === 'object' ? value : {};
  return {
    id: text(data.id, 80),
    weekKey: weekKey(data.weekKey),
    poster: POSTERS.includes(data.poster) ? data.poster : '',
    userId: text(data.userId, 80),
    designerName: text(data.designerName, 80),
    weTransferUrl: weTransferUrl(data.weTransferUrl),
    note: text(data.note, 600),
    status: ['pending', 'approved', 'changes'].includes(data.status) ? data.status : 'pending',
    reviewNote: text(data.reviewNote, 600),
    submittedAt: Number.isFinite(data.submittedAt) ? data.submittedAt : Date.now(),
    reviewedAt: Number.isFinite(data.reviewedAt) ? data.reviewedAt : 0,
    reviewedBy: text(data.reviewedBy, 80)
  };
}

module.exports = { POSTERS, text, email, password, weTransferUrl, weekKey, cleanEvent, cleanSubmission };
