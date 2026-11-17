const POSTERS = ['BT-MGS', 'BT-GDADM', 'KMZ'];
const EPOCH = Date.UTC(1970, 0, 1);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = v => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.href : ''; } catch (e) { return ''; } };
const ymd = d => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const fmt = (d, o) => d.toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o));
const titles = { overview: 'Overview', review: 'Review queue', schedule: 'Schedule', people: 'People & rotation', events: 'Events', account: 'Account' };
const state = {
  me: null,
  users: [],
  schedule: { roster: [], done: {}, salt: 0 },
  submissions: [],
  events: [],
  panel: 'overview',
  viewMonth: (() => { const n = new Date(); return utc(n.getUTCFullYear(), n.getUTCMonth(), 1); })()
};

function thursdays(y, m) {
  const out = [];
  const d = utc(y, m, 1);
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCMonth() === m) { out.push(new Date(d)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}

function hash32(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}

function weekIndex(d) {
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH) / 604800000);
}

function rosterName(entry) {
  if (typeof entry === 'string') return entry;
  return entry && typeof entry === 'object' ? String(entry.name || '') : '';
}

function assign(thu) {
  const names = state.schedule.roster.map(rosterName).filter(Boolean);
  if (!names.length) return POSTERS.map(poster => ({ poster, name: '' }));
  const w = weekIndex(thu);
  const salt = state.schedule.salt >>> 0;
  const raw = i => hash32(salt ^ i) % names.length;
  let b = raw(0);
  const dir = w > 0 ? 1 : -1;
  for (let i = dir; i !== w + dir; i += dir) {
    let r = raw(i);
    if (r === b) r = (r + 1) % names.length;
    b = r;
  }
  return POSTERS.map((poster, i) => ({ poster, name: names[(b + i) % names.length] }));
}

function statusFor(done, today, thu, last) {
  if (done) return ['Ready', ''];
  const n = Math.round((thu - today) / 86400000);
  if (n > 0) return ['Due in ' + n + (n === 1 ? ' day' : ' days'), ''];
  if (n === 0) return ['Due today', 'warn'];
  if (today.getTime() === last.getTime()) return ['Final day today', 'warn'];
  return ['Overdue', 'bad'];
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function postJson(url, action, extra) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ action }, extra || {}))
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

let toastTimer;
function toast(message) {
  const el = $('adminToast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function setMsg(id, message, good) {
  const el = $(id);
  el.textContent = message;
  el.className = good ? 'msg good' : 'msg';
}

function updateThemeMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#26221f' : '#f7f5f0');
}

function isAdmin() {
  return !!state.me && state.me.role === 'admin';
}

function applyGate() {
  const admin = isAdmin();
  $('adminShell').hidden = !admin;
  $('adminGate').hidden = admin;
  $('adminLoginForm').hidden = !!state.me;
  $('adminDenied').hidden = !state.me || admin;
  if (state.me && !admin) {
    $('deniedIdentity').textContent = 'Signed in as ' + state.me.email + '. This account does not have admin access.';
    $('gateIntro').textContent = 'This console is restricted to admin accounts.';
  } else if (!state.me) {
    $('gateIntro').textContent = 'Sign in with an admin account to manage the schedule.';
  }
}

function setPanel(panel) {
  state.panel = panel;
  document.querySelectorAll('.admin-panel').forEach(section => { section.hidden = section.dataset.panelPanel !== panel; });
  document.querySelectorAll('.admin-nav-link').forEach(button => button.classList.toggle('active', button.dataset.panel === panel));
  $('adminTitle').textContent = titles[panel] || 'Admin';
  if (location.hash.slice(1) !== panel) history.replaceState(null, '', '#' + panel);
}

function renderOverview() {
  const now = Date.now();
  const pending = state.submissions.filter(s => s.status === 'pending').length;
  const prefix = ymd(utc(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).slice(0, 7);
  const weeks = thursdays(new Date().getUTCFullYear(), new Date().getUTCMonth());
  const total = weeks.length * POSTERS.length;
  const ready = Object.keys(state.schedule.done || {}).filter(key => key.startsWith(prefix + '-')).length;
  const upcoming = state.events.filter(e => new Date(e.endsAt || e.startsAt).getTime() >= now).length;
  $('ovPending').textContent = String(pending);
  $('ovDesigners').textContent = String((state.schedule.roster || []).length);
  $('ovReady').textContent = ready + ' / ' + total;
  $('ovEvents').textContent = String(upcoming);
  $('ovFill').style.width = (total ? (ready / total) * 100 : 0) + '%';
  const badge = $('adminReviewBadge');
  badge.hidden = !pending;
  badge.textContent = pending > 99 ? '99+' : String(pending);
  $('adminReviewCount').textContent = String(pending);
  $('adminIdentity').textContent = state.me ? state.me.email : '';
}

function statusBadge(status) {
  return '<span class="status ' + esc(status) + '">' + esc(status === 'changes' ? 'needs changes' : status) + '</span>';
}

function reviewMarkup(s) {
  const url = safeUrl(s.weTransferUrl);
  const link = url ? '<p><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open WeTransfer link ↗</a></p>' : '<p class="meta">No link supplied.</p>';
  const note = s.note ? '<p>' + esc(s.note) + '</p>' : '';
  const reviewNote = s.reviewNote ? '<p class="meta">Your note: ' + esc(s.reviewNote) + '</p>' : '';
  const meta = '<p class="meta">' + esc(s.designerName) + ' · ' + esc(s.poster) + ' · week ' + esc(s.weekKey) + '</p>';
  const actions = s.status === 'pending'
    ? '<div class="item-actions"><label>Review note<input type="text" class="review-note" maxlength="600" placeholder="Optional note for the designer"></label><button class="btn primary" type="button" data-review="approved" data-id="' + esc(s.id) + '">Approve</button><button class="btn" type="button" data-review="changes" data-id="' + esc(s.id) + '">Request changes</button></div>'
    : '';
  return '<li class="item"><div class="item-head"><h4>' + esc(s.poster) + '</h4>' + statusBadge(s.status) + '</div>' + meta + link + note + reviewNote + actions + '</li>';
}

function renderReview() {
  const queue = state.submissions.slice().sort((a, b) => {
    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
    return b.submittedAt - a.submittedAt;
  });
  const focused = document.activeElement && $('adminReviewQueue').contains(document.activeElement);
  if (focused) return;
  $('adminReviewQueue').innerHTML = queue.length
    ? queue.map(reviewMarkup).join('')
    : '<li class="empty">Nothing to review right now.</li>';
}

function renderAdminSchedule() {
  const y = state.viewMonth.getUTCFullYear();
  const m = state.viewMonth.getUTCMonth();
  const weeks = thursdays(y, m);
  const now = new Date();
  const today = utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  $('adminMonth').textContent = fmt(state.viewMonth, { month: 'long', year: 'numeric' });
  $('adminWeeks').innerHTML = weeks.map(thu => {
    const last = new Date(thu); last.setUTCDate(thu.getUTCDate() + 1);
    const mon = new Date(thu); mon.setUTCDate(thu.getUTCDate() - 3);
    const end = new Date(thu); end.setUTCDate(thu.getUTCDate() + 3);
    const current = today >= mon && today <= end;
    const people = assign(thu);
    const tiles = POSTERS.map((poster, i) => {
      const key = ymd(thu) + '|' + poster;
      const done = !!state.schedule.done[key];
      const s = statusFor(done, today, thu, last);
      const name = people[i].name;
      return '<label class="tile' + (done ? ' done' : '') + '"><input type="checkbox" data-key="' + esc(key) + '"' + (done ? ' checked' : '') + '><span><b>' + poster + '</b><em class="who' + (name ? '' : ' empty') + '">' + (name ? esc(name) : 'Unassigned') + '</em><small class="' + s[1] + '">' + s[0] + '</small></span></label>';
    }).join('');
    return '<article class="week' + (current ? ' now' : '') + '"><div><div class="day">' + thu.getUTCDate() + '</div><div class="monthday">' + fmt(thu, { weekday: 'long', month: 'short' }) + '</div><div class="latest">Latest: ' + fmt(last, { weekday: 'short', day: 'numeric', month: 'short' }) + '</div></div><div class="tiles">' + tiles + '</div></article>';
  }).join('') || '<div class="empty">No Thursdays in this month.</div>';
}

function renderPeople() {
  $('userList').innerHTML = state.users.length
    ? state.users.map(u => '<div class="user-row"><div><strong>' + esc(u.name) + '</strong><br><span>' + esc(u.email) + '</span></div><span>' + esc(u.role.toUpperCase()) + '</span></div>').join('')
    : '<p class="meta">No accounts found.</p>';
  const roster = state.schedule.roster || [];
  $('rosterManage').innerHTML = roster.length
    ? roster.map((entry, i) => '<div class="user-row"><div><strong>' + esc(rosterName(entry)) + '</strong><br><span>' + (entry && entry.userId ? 'ACCOUNT' : 'LEGACY NAME') + '</span></div><button class="btn" type="button" data-remove="' + i + '">Remove from rotation</button></div>').join('')
    : '<div class="empty">No designers in the rotation.</div>';
}

function eventMarkup(e) {
  const now = Date.now();
  const start = new Date(e.startsAt);
  const end = e.endsAt ? new Date(e.endsAt) : null;
  const past = (end || start).getTime() < now;
  const isToday = ymd(start) === ymd(new Date());
  const stateClass = isToday ? 'today' : past ? 'past' : 'upcoming';
  const label = isToday ? 'Today' : past ? 'Past' : 'Upcoming';
  const day = fmt(start, { day: '2-digit' });
  const month = fmt(start, { month: 'short' }).replace('.', '').toUpperCase();
  const startDate = fmt(start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const startTime = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const when = startDate + ' · ' + startTime + (end ? ' – ' + fmt(end, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const link = safeUrl(e.link) ? '<p><a href="' + esc(safeUrl(e.link)) + '" target="_blank" rel="noopener noreferrer">Event link ↗</a></p>' : '';
  return '<li class="item event-item ' + stateClass + '">' +
    '<time class="event-marker" datetime="' + esc(e.startsAt) + '" aria-label="' + esc(when) + '"><span class="marker-day">' + esc(day) + '</span><span class="marker-month">' + esc(month) + '</span></time>' +
    '<div class="event-body"><div class="item-head"><h4>' + esc(e.title) + '</h4><span class="event-label">' + label + '</span></div>' +
    '<p class="event-when">' + esc(when) + '</p>' +
    (e.location ? '<p class="meta">' + esc(e.location) + '</p>' : '') +
    (e.description ? '<p>' + esc(e.description) + '</p>' : '') + link +
    '<div class="item-actions"><button class="btn" type="button" data-edit="' + esc(e.id) + '">Edit</button><button class="btn danger" type="button" data-delete="' + esc(e.id) + '">Delete</button></div></div></li>';
}

function renderAdminEvents() {
  $('adminEventList').innerHTML = state.events.length
    ? state.events.map(eventMarkup).join('')
    : '<li class="empty">No events yet.</li>';
}

function render() {
  if (!isAdmin()) return;
  renderOverview();
  renderReview();
  renderAdminSchedule();
  renderPeople();
  renderAdminEvents();
}

async function loadAll(silent) {
  try {
    const [authData, scheduleData, submissionData, eventData] = await Promise.all([
      getJson('/api/auth'),
      getJson('/api/schedule'),
      getJson('/api/submissions'),
      getJson('/api/events')
    ]);
    state.me = authData.user || null;
    state.users = authData.users || [];
    state.schedule = scheduleData;
    state.submissions = submissionData.submissions || [];
    state.events = eventData.events || [];
    applyGate();
    if (isAdmin()) render();
  } catch (e) {
    applyGate();
    if (!silent) toast(e.message || 'Unable to load admin data.');
  }
}

document.querySelectorAll('.admin-nav-link').forEach(button => button.addEventListener('click', () => setPanel(button.dataset.panel)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => setPanel(button.dataset.go)));

$('adminThemeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  updateThemeMeta(next);
  $('adminThemeBtn').textContent = next === 'dark' ? 'L' : 'D';
  $('adminThemeBtn').setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  try { localStorage.setItem('gs-theme', next); } catch (e) {}
});

$('adminLoginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    await postJson('/api/auth', 'login', { email: $('adminLoginEmail').value, password: $('adminLoginPassword').value });
    $('adminLoginPassword').value = '';
    $('adminLoginMsg').textContent = '';
    await loadAll();
  } catch (err) {
    $('adminLoginMsg').textContent = err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
});

async function signOut() {
  try { await postJson('/api/auth', 'logout'); } catch (e) {}
  await loadAll(true);
  toast('Signed out.');
}
$('adminSignOutBtn').addEventListener('click', signOut);
$('deniedSignOutBtn').addEventListener('click', signOut);

$('adminPrev').addEventListener('click', () => { state.viewMonth = utc(state.viewMonth.getUTCFullYear(), state.viewMonth.getUTCMonth() - 1, 1); renderAdminSchedule(); });
$('adminNext').addEventListener('click', () => { state.viewMonth = utc(state.viewMonth.getUTCFullYear(), state.viewMonth.getUTCMonth() + 1, 1); renderAdminSchedule(); });
$('adminToday').addEventListener('click', () => { state.viewMonth = utc(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1); renderAdminSchedule(); });

$('adminWeeks').addEventListener('change', async e => {
  const box = e.target;
  if (!box.dataset.key) return;
  const key = box.dataset.key;
  const value = box.checked;
  if (value) state.schedule.done[key] = true; else delete state.schedule.done[key];
  renderAdminSchedule();
  try { await postJson('/api/schedule', 'done', { key, value }); }
  catch (err) { toast(err.message); await loadAll(true); }
});

$('adminReviewQueue').addEventListener('click', async e => {
  const btn = e.target.closest('[data-review]');
  if (!btn) return;
  const note = btn.closest('.item').querySelector('.review-note');
  try {
    await postJson('/api/submissions', 'review', { id: btn.dataset.id, decision: btn.dataset.review, note: note ? note.value : '' });
    await loadAll(true);
    toast(btn.dataset.review === 'approved' ? 'Poster approved.' : 'Changes requested.');
  } catch (err) { toast(err.message); }
});

$('createUserForm').addEventListener('submit', async e => {
  e.preventDefault();
  setMsg('createMsg', '');
  try {
    const data = await postJson('/api/auth', 'create-user', {
      name: $('newName').value,
      email: $('newEmail').value,
      password: $('newPassword').value,
      role: $('newRole').value
    });
    $('createUserForm').reset();
    setMsg('createMsg', 'Account created and added to rotation.' + (data.warning ? ' ' + data.warning : ''), true);
    await loadAll(true);
  } catch (err) { setMsg('createMsg', err.message); }
});
$('passwordForm').addEventListener('submit', async e => {
  e.preventDefault();
  setMsg('passwordMsg', '');
  try {
    await postJson('/api/auth', 'change-password', { current: $('curPassword').value, next: $('newPassword2').value });
    $('passwordForm').reset();
    setMsg('passwordMsg', 'Password updated.', true);
  } catch (err) { setMsg('passwordMsg', err.message); }
});
$('rosterManage').addEventListener('click', async e => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  try {
    await postJson('/api/schedule', 'remove-from-roster', { index: Number(btn.dataset.remove) });
    await loadAll(true);
    toast('Removed from rotation.');
  } catch (err) { toast(err.message); }
});
$('shuffleBtn').addEventListener('click', async () => {
  try {
    await postJson('/api/schedule', 'shuffle');
    await loadAll(true);
    setMsg('adminMsg', 'Rotation reshuffled.', true);
  } catch (err) { setMsg('adminMsg', err.message); }
});
$('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear all ready marks?')) return;
  try {
    await postJson('/api/schedule', 'clear');
    await loadAll(true);
    setMsg('adminMsg', 'Ready marks cleared.', true);
  } catch (err) { setMsg('adminMsg', err.message); }
});

$('addAdminEventBtn').addEventListener('click', () => {
  $('adminEventForm').reset();
  $('eventId').value = '';
  $('adminEventFormTitle').textContent = 'Add an event';
  setMsg('eventMsg', '');
  $('adminEventForm').hidden = false;
  $('eventTitle').focus();
});
$('adminEventCancel').addEventListener('click', () => { $('adminEventForm').hidden = true; });
$('adminEventForm').addEventListener('submit', async e => {
  e.preventDefault();
  setMsg('eventMsg', '');
  const toIso = value => value ? new Date(value).toISOString() : '';
  try {
    await postJson('/api/events', 'save', {
      id: $('eventId').value,
      title: $('eventTitle').value,
      startsAt: toIso($('eventStart').value),
      endsAt: toIso($('eventEnd').value),
      location: $('eventLocation').value,
      link: $('eventLink').value,
      description: $('eventDescription').value
    });
    $('adminEventForm').reset();
    $('eventId').value = '';
    $('adminEventForm').hidden = true;
    setMsg('eventMsg', 'Event saved.', true);
    await loadAll(true);
  } catch (err) { setMsg('eventMsg', err.message); }
});
$('adminEventList').addEventListener('click', async e => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-delete]');
  if (edit) {
    const event = state.events.find(x => x.id === edit.dataset.edit);
    if (!event) return;
    $('eventId').value = event.id;
    $('eventTitle').value = event.title;
    $('eventStart').value = event.startsAt ? event.startsAt.slice(0, 16) : '';
    $('eventEnd').value = event.endsAt ? event.endsAt.slice(0, 16) : '';
    $('eventLocation').value = event.location || '';
    $('eventLink').value = event.link || '';
    $('eventDescription').value = event.description || '';
    $('adminEventFormTitle').textContent = 'Edit event';
    $('adminEventForm').hidden = false;
    $('eventTitle').focus();
    return;
  }
  if (del) {
    if (!confirm('Delete this event?')) return;
    try {
      await postJson('/api/events', 'delete', { id: del.dataset.delete });
      await loadAll(true);
      toast('Event deleted.');
    } catch (err) { toast(err.message); }
  }
});

async function init() {
  try {
    const saved = localStorage.getItem('gs-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch (e) {}
  const theme = document.documentElement.dataset.theme;
  updateThemeMeta(theme);
  $('adminThemeBtn').textContent = theme === 'dark' ? 'L' : 'D';
  $('adminThemeBtn').setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  const initial = location.hash.slice(1);
  setPanel(Object.keys(titles).includes(initial) ? initial : 'overview');
  await loadAll();
  setInterval(() => { if (isAdmin() && !document.hidden) loadAll(true); }, 5000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}
init();
