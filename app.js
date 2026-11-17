const POSTERS = ['BT-MGS', 'BT-GDADM', 'KMZ'];
const EPOCH = Date.UTC(1970, 0, 1);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = v => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.href : ''; } catch (e) { return ''; } };
const ymd = d => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const fmt = (d, o) => d.toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o));
const state = {
  me: null,
  schedule: { roster: [], done: {}, salt: 0 },
  submissions: [],
  events: [],
  view: 'schedule',
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
  const el = $('toast');
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

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('installBtn').hidden = false;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  $('installBtn').hidden = true;
});
$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('installBtn').hidden = true;
  if (choice && choice.outcome === 'accepted') toast('App installed.');
});

function showView(view) {
  state.view = view;
  document.querySelectorAll('[data-view-panel]').forEach(panel => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
}

function renderHeader() {
  $('authBtn').hidden = !!state.me;
  $('signOutBtn').hidden = !state.me;
  $('sync').textContent = state.me ? 'signed in' : 'read only';
}

function renderSchedule() {
  const roster = state.schedule.roster || [];
  $('team').innerHTML = roster.length
    ? roster.map(entry => '<li class="chip"><b>' + esc(rosterName(entry)) + '</b><span>DESIGNER</span></li>').join('')
    : '<li class="empty">No designers in the pool yet.</li>';

  const y = state.viewMonth.getUTCFullYear();
  const m = state.viewMonth.getUTCMonth();
  const weeks = thursdays(y, m);
  let total = 0;
  let done = 0;
  const now = new Date();
  const today = utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  $('month').textContent = fmt(state.viewMonth, { month: 'long', year: 'numeric' });

  $('weeks').innerHTML = weeks.map(thu => {
    const last = new Date(thu); last.setUTCDate(thu.getUTCDate() + 1);
    const mon = new Date(thu); mon.setUTCDate(thu.getUTCDate() - 3);
    const end = new Date(thu); end.setUTCDate(thu.getUTCDate() + 3);
    const current = today >= mon && today <= end;
    const people = assign(thu);
    const tiles = POSTERS.map((poster, i) => {
      const key = ymd(thu) + '|' + poster;
      const isDone = !!state.schedule.done[key];
      total++;
      if (isDone) done++;
      const s = statusFor(isDone, today, thu, last);
      const name = people[i].name;
      return '<div class="tile' + (isDone ? ' done' : '') + '"><span><b>' + poster + '</b><em class="who' + (name ? '' : ' empty') + '">' + (name ? esc(name) : 'Unassigned') + '</em><small class="' + s[1] + '">' + s[0] + '</small></span></div>';
    }).join('');
    return '<article class="week' + (current ? ' now' : '') + '"><div><div class="day">' + thu.getUTCDate() + '</div><div class="monthday">' + fmt(thu, { weekday: 'long', month: 'short' }) + '</div><div class="latest">Latest: ' + fmt(last, { weekday: 'short', day: 'numeric', month: 'short' }) + '</div></div><div class="tiles">' + tiles + '</div></article>';
  }).join('') || '<div class="empty">No Thursdays in this month.</div>';

  $('statDesigners').textContent = String(roster.length);
  $('statReady').textContent = done + ' / ' + total;
  $('statMine').textContent = String(state.me ? state.submissions.filter(s => s.userId === state.me.id).length : 0);
  $('progressFill').style.width = (total ? (done / total) * 100 : 0) + '%';
}

function populateWeekSelect() {
  const select = $('submitWeek');
  if (select.options.length) return;
  const now = new Date();
  const seen = new Set();
  const options = [];
  for (let offset = -1; offset <= 2; offset++) {
    const d = utc(now.getUTCFullYear(), now.getUTCMonth() + offset, 1);
    thursdays(d.getUTCFullYear(), d.getUTCMonth()).forEach(thu => {
      const key = ymd(thu);
      if (seen.has(key)) return;
      seen.add(key);
      options.push('<option value="' + key + '">' + fmt(thu, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '</option>');
    });
  }
  select.innerHTML = options.join('');
  $('submitPoster').innerHTML = POSTERS.map(p => '<option value="' + p + '">' + p + '</option>').join('');
}

function submissionMarkup(s) {
  const url = safeUrl(s.weTransferUrl);
  const link = url ? '<p><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open WeTransfer link ↗</a></p>' : '';
  const note = s.note ? '<p>' + esc(s.note) + '</p>' : '';
  const reviewNote = s.reviewNote ? '<p class="meta">Reviewer note: ' + esc(s.reviewNote) + '</p>' : '';
  const meta = '<p class="meta">' + esc(s.poster) + ' · week ' + esc(s.weekKey) + '</p>';
  const status = '<span class="status ' + esc(s.status) + '">' + esc(s.status === 'changes' ? 'needs changes' : s.status) + '</span>';
  const actions = s.status !== 'approved'
    ? '<div class="item-actions"><button class="btn" type="button" data-withdraw="' + esc(s.id) + '">Withdraw</button></div>'
    : '';
  return '<li class="item"><div class="item-head"><h4>' + esc(s.poster) + '</h4>' + status + '</div>' + meta + link + note + reviewNote + actions + '</li>';
}

function renderSubmissions() {
  populateWeekSelect();
  const mine = state.me ? state.submissions.filter(s => s.userId === state.me.id) : [];
  $('mySubmissions').innerHTML = mine.length
    ? mine.map(submissionMarkup).join('')
    : '<li class="empty">' + (state.me ? 'No submissions yet.' : 'Sign in to submit a poster.') + '</li>';
}

function renderEvents() {
  const now = Date.now();
  const todayKey = ymd(new Date());
  const sorted = state.events.slice().sort((a, b) => {
    const aPast = new Date(a.endsAt || a.startsAt).getTime() < now;
    const bPast = new Date(b.endsAt || b.startsAt).getTime() < now;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return new Date(a.startsAt) - new Date(b.startsAt);
  });
  $('eventList').innerHTML = sorted.length
    ? sorted.map(e => {
      const start = new Date(e.startsAt);
      const end = e.endsAt ? new Date(e.endsAt) : null;
      const past = (end || start).getTime() < now;
      const isToday = ymd(start) === todayKey;
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
        (e.description ? '<p>' + esc(e.description) + '</p>' : '') + link + '</div></li>';
    }).join('')
    : '<li class="empty">No upcoming events yet.</li>';
}

function render() {
  renderHeader();
  renderSchedule();
  renderSubmissions();
  renderEvents();
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
    state.schedule = scheduleData;
    state.submissions = submissionData.submissions || [];
    state.events = eventData.events || [];
    render();
  } catch (e) {
    if (!silent) toast(e.message || 'Unable to load data.');
  }
}

document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => showView(link.dataset.view)));

$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  updateThemeMeta(next);
  $('themeBtn').textContent = next === 'dark' ? 'L' : 'D';
  $('themeBtn').setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  try { localStorage.setItem('gs-theme', next); } catch (e) {}
});

$('authBtn').addEventListener('click', () => {
  $('loginMsg').textContent = '';
  $('authDialog').showModal();
  $('loginEmail').focus();
});
$('loginCancel').addEventListener('click', () => $('authDialog').close());
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    await postJson('/api/auth', 'login', { email: $('loginEmail').value, password: $('loginPassword').value });
    $('authDialog').close();
    $('loginPassword').value = '';
    await loadAll(true);
    toast('Signed in.');
  } catch (err) {
    $('loginMsg').textContent = err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
});
$('signOutBtn').addEventListener('click', async () => {
  try { await postJson('/api/auth', 'logout'); } catch (e) {}
  await loadAll(true);
  toast('Signed out.');
});

$('prev').addEventListener('click', () => { state.viewMonth = utc(state.viewMonth.getUTCFullYear(), state.viewMonth.getUTCMonth() - 1, 1); renderSchedule(); });
$('next').addEventListener('click', () => { state.viewMonth = utc(state.viewMonth.getUTCFullYear(), state.viewMonth.getUTCMonth() + 1, 1); renderSchedule(); });
$('today').addEventListener('click', () => { state.viewMonth = utc(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1); renderSchedule(); });

$('submitForm').addEventListener('submit', async e => {
  e.preventDefault();
  setMsg('submitMsg', '');
  try {
    await postJson('/api/submissions', 'submit', {
      weekKey: $('submitWeek').value,
      poster: $('submitPoster').value,
      weTransferUrl: $('submitUrl').value,
      note: $('submitNote').value
    });
    $('submitUrl').value = '';
    $('submitNote').value = '';
    setMsg('submitMsg', 'Submitted. The team has been notified.', true);
    await loadAll(true);
  } catch (err) {
    setMsg('submitMsg', err.message);
  }
});

$('mySubmissions').addEventListener('click', async e => {
  const btn = e.target.closest('[data-withdraw]');
  if (!btn) return;
  try {
    await postJson('/api/submissions', 'withdraw', { id: btn.dataset.withdraw });
    await loadAll(true);
    toast('Submission withdrawn.');
  } catch (err) { toast(err.message); }
});

async function init() {
  try {
    const saved = localStorage.getItem('gs-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch (e) {}
  const theme = document.documentElement.dataset.theme;
  updateThemeMeta(theme);
  $('themeBtn').textContent = theme === 'dark' ? 'L' : 'D';
  $('themeBtn').setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  const initial = location.hash.slice(1);
  showView(['schedule', 'submissions', 'events'].includes(initial) ? initial : 'schedule');
  await loadAll();
  setInterval(() => { if (!document.hidden) loadAll(true); }, 5000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}
init();
