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
  schedule: { roster: [], done: {}, salt: 0, user: null, canManage: false },
  submissions: [],
  events: [],
  pendingCount: 0,
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

function showView(view) {
  state.view = view;
  document.querySelectorAll('[data-view-panel]').forEach(panel => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
}

function renderHeader() {
  const admin = !!state.me && state.me.role === 'admin';
  if (state.view === 'admin' && !admin) showView('schedule');
  if (!admin) $('eventForm').hidden = true;
  $('authBtn').hidden = !!state.me;
  $('signOutBtn').hidden = !state.me;
  $('adminNav').hidden = !admin;
  $('addEventBtn').hidden = !admin;
  $('reviewSection').hidden = !admin;
  $('profile').textContent = state.me
    ? 'Signed in as ' + state.me.name + ' (' + state.me.email + '). New accounts and rotation are managed here.'
    : 'Sign in to create and review posters.';
  const count = state.pendingCount;
  $('reviewBadge').hidden = !admin || !count;
  $('reviewBadge').textContent = count > 99 ? '99+' : String(count);
  $('reviewCount').textContent = String(count);
  $('sync').textContent = state.me ? 'signed in' : 'read only';
}

function renderSchedule() {
  const roster = state.schedule.roster || [];
  $('team').innerHTML = roster.length
    ? roster.map(entry => '<li class="chip"><b>' + esc(rosterName(entry)) + '</b><span>' + (entry && entry.userId ? 'ACCOUNT' : 'LEGACY') + '</span></li>').join('')
    : '<li class="empty">No designers in the pool yet. Add an account from the Admin page.</li>';

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
      return '<label class="tile' + (isDone ? ' done' : '') + '"><input type="checkbox" data-key="' + esc(key) + '"' + (isDone ? ' checked' : '') + (state.me ? '' : ' disabled') + '><span><b>' + poster + '</b><em class="who' + (name ? '' : ' empty') + '">' + (name ? esc(name) : 'Unassigned') + '</em><small class="' + s[1] + '">' + s[0] + '</small></span></label>';
    }).join('');
    return '<article class="week' + (current ? ' now' : '') + '"><div><div class="day">' + thu.getUTCDate() + '</div><div class="monthday">' + fmt(thu, { weekday: 'long', month: 'short' }) + '</div><div class="latest">Latest: ' + fmt(last, { weekday: 'short', day: 'numeric', month: 'short' }) + '</div></div><div class="tiles">' + tiles + '</div></article>';
  }).join('') || '<div class="empty">No Thursdays in this month.</div>';

  $('statDesigners').textContent = String(roster.length);
  $('statReady').textContent = done + ' / ' + total;
  $('statPending').textContent = String(state.pendingCount);
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

function statusBadge(status) {
  return '<span class="status ' + esc(status) + '">' + esc(status === 'changes' ? 'needs changes' : status) + '</span>';
}

function submissionMarkup(s, review) {
  const url = safeUrl(s.weTransferUrl);
  const link = url ? '<p><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open WeTransfer link ↗</a></p>' : '';
  const note = s.note ? '<p>' + esc(s.note) + '</p>' : '';
  const reviewNote = s.reviewNote ? '<p class="meta">Reviewer note: ' + esc(s.reviewNote) + '</p>' : '';
  const meta = '<p class="meta">' + esc(s.designerName) + ' · ' + esc(s.poster) + ' · week ' + esc(s.weekKey) + '</p>';
  let actions = '';
  if (review && s.status === 'pending') {
    actions = '<div class="item-actions"><label>Review note<input type="text" class="review-note" maxlength="600" placeholder="Optional note for the designer"></label><button class="btn primary" type="button" data-review="approved" data-id="' + esc(s.id) + '">Approve</button><button class="btn" type="button" data-review="changes" data-id="' + esc(s.id) + '">Request changes</button></div>';
  }
  if (!review && state.me && s.userId === state.me.id && s.status !== 'approved') {
    actions = '<div class="item-actions"><button class="btn" type="button" data-withdraw="' + esc(s.id) + '">Withdraw</button></div>';
  }
  return '<li class="item"><div class="item-head"><h4>' + esc(s.poster) + '</h4>' + statusBadge(s.status) + '</div>' + meta + link + note + reviewNote + actions + '</li>';
}

function renderSubmissions() {
  populateWeekSelect();
  const mine = state.me ? state.submissions.filter(s => s.userId === state.me.id) : [];
  $('mySubmissions').innerHTML = mine.length
    ? mine.map(s => submissionMarkup(s, false)).join('')
    : '<li class="empty">' + (state.me ? 'No submissions yet.' : 'Sign in to submit a poster.') + '</li>';

  if (state.me && state.me.role === 'admin') {
    const queue = state.submissions.slice().sort((a, b) => {
      if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
      return b.submittedAt - a.submittedAt;
    });
    const focused = document.activeElement && $('reviewQueue').contains(document.activeElement);
    if (!focused) {
      $('reviewQueue').innerHTML = queue.length
        ? queue.map(s => submissionMarkup(s, true)).join('')
        : '<li class="empty">Nothing to review right now.</li>';
    }
  }
}

function renderEvents() {
  const now = Date.now();
  $('eventList').innerHTML = state.events.length
    ? state.events.map(e => {
      const past = new Date(e.endsAt || e.startsAt).getTime() < now;
      const date = e.startsAt ? fmt(new Date(e.startsAt), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
      const link = safeUrl(e.link) ? '<p><a href="' + esc(safeUrl(e.link)) + '" target="_blank" rel="noopener noreferrer">Event link ↗</a></p>' : '';
      const actions = state.me && state.me.role === 'admin'
        ? '<div class="item-actions"><button class="btn" type="button" data-edit="' + esc(e.id) + '">Edit</button><button class="btn danger" type="button" data-delete="' + esc(e.id) + '">Delete</button></div>'
        : '';
      return '<li class="item"' + (past ? ' style="opacity:.6"' : '') + '><div class="item-head"><h4>' + esc(e.title) + '</h4><span class="event-date">' + esc(date) + (past ? ' · PAST' : '') + '</span></div>' + (e.location ? '<p class="meta">' + esc(e.location) + '</p>' : '') + (e.description ? '<p>' + esc(e.description) + '</p>' : '') + link + actions + '</li>';
    }).join('')
    : '<li class="empty">No upcoming events yet.</li>';
}

function renderAdmin() {
  if (!state.me || state.me.role !== 'admin') return;
  $('userList').innerHTML = state.users && state.users.length
    ? state.users.map(u => '<div class="user-row"><div><strong>' + esc(u.name) + '</strong><br><span>' + esc(u.email) + '</span></div><span>' + esc(u.role.toUpperCase()) + '</span></div>').join('')
    : '<p class="meta">No accounts found.</p>';

  const roster = state.schedule.roster || [];
  $('rosterManage').innerHTML = roster.length
    ? roster.map((entry, i) => '<div class="user-row"><div><strong>' + esc(rosterName(entry)) + '</strong><br><span>' + (entry && entry.userId ? 'ACCOUNT' : 'LEGACY NAME') + '</span></div><button class="btn" type="button" data-remove="' + i + '">Remove from rotation</button></div>').join('')
    : '<div class="empty">No designers in the rotation.</div>';
}

function render() {
  renderHeader();
  renderSchedule();
  renderSubmissions();
  renderEvents();
  renderAdmin();
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
    state.pendingCount = submissionData.pendingCount || 0;
    state.events = eventData.events || [];
    state.users = authData.users || state.users || [];
    render();
  } catch (e) {
    if (!silent) toast(e.message || 'Unable to load data.');
  }
}

document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => showView(link.dataset.view)));

$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
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

$('weeks').addEventListener('change', async e => {
  const box = e.target;
  if (!box.dataset.key) return;
  const key = box.dataset.key;
  const value = box.checked;
  if (state.schedule.done) {
    if (value) state.schedule.done[key] = true; else delete state.schedule.done[key];
  }
  renderSchedule();
  try { await postJson('/api/schedule', 'done', { key, value }); }
  catch (err) { toast(err.message); await loadAll(true); }
});

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
    setMsg('submitMsg', 'Submitted. Admins have been notified.', true);
    await loadAll(true);
  } catch (err) {
    setMsg('submitMsg', err.message);
  }
});

$('reviewQueue').addEventListener('click', async e => {
  const btn = e.target.closest('[data-review]');
  if (!btn) return;
  const note = btn.closest('.item').querySelector('.review-note');
  try {
    await postJson('/api/submissions', 'review', { id: btn.dataset.id, decision: btn.dataset.review, note: note ? note.value : '' });
    await loadAll(true);
    toast(btn.dataset.review === 'approved' ? 'Poster approved.' : 'Changes requested.');
  } catch (err) { toast(err.message); }
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

$('addEventBtn').addEventListener('click', () => {
  $('eventForm').reset();
  $('eventId').value = '';
  $('eventFormTitle').textContent = 'Add an event';
  setMsg('eventMsg', '');
  $('eventForm').hidden = false;
  $('eventTitle').focus();
});
$('eventCancel').addEventListener('click', () => { $('eventForm').hidden = true; });
$('eventForm').addEventListener('submit', async e => {
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
    $('eventForm').reset();
    $('eventId').value = '';
    $('eventForm').hidden = true;
    setMsg('eventMsg', 'Event saved.', true);
    await loadAll(true);
  } catch (err) { setMsg('eventMsg', err.message); }
});
$('eventList').addEventListener('click', async e => {
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
    $('eventFormTitle').textContent = 'Edit event';
    $('eventForm').hidden = false;
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
  if (!confirm('Clear all completion marks?')) return;
  try {
    await postJson('/api/schedule', 'clear');
    await loadAll(true);
    setMsg('adminMsg', 'Progress cleared.', true);
  } catch (err) { setMsg('adminMsg', err.message); }
});

async function init() {
  try {
    const saved = localStorage.getItem('gs-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch (e) {}
  $('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? 'L' : 'D';
  $('themeBtn').setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  const initial = location.hash.slice(1);
  showView(['schedule', 'submissions', 'events', 'admin'].includes(initial) ? initial : 'schedule');
  await loadAll();
  setInterval(() => { if (!document.hidden) loadAll(true); }, 5000);
}
init();
