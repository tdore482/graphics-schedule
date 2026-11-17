const store = require('../lib/store');
const http = require('../lib/http');
const auth = require('../lib/auth');
const validate = require('../lib/validate');
const email = require('../lib/email');
const rotation = require('../lib/rotation');

function normalizeRoster(value) {
  return (Array.isArray(value) ? value : []).map(entry => ({
    userId: entry && typeof entry === 'object' ? validate.text(entry.userId, 80) : null,
    name: validate.text(rotation.rosterName(entry), 80)
  })).filter(e => e.name);
}

function normalizeSubmissions(value) {
  return (Array.isArray(value) ? value : []).map(validate.cleanSubmission)
    .filter(s => s.id && s.weekKey && s.poster && s.userId);
}

function findUser(account, name) {
  const needle = String(name || '').toLowerCase();
  return account.users.find(u => u.active && u.role === 'designer' && u.name.toLowerCase() === needle) || null;
}

async function sendDesignerMail(user, subject, lines) {
  if (!user) return 0;
  const result = await email.sendEmail(user.email, subject, `${lines}\n\n${process.env.APP_URL || ''}/#submissions`);
  return result.ok ? 1 : 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  const supplied = (req.headers && req.headers.authorization === `Bearer ${secret}`)
    || (req.query && req.query.secret === secret);
  if (!secret || !supplied) return http.send(res, 401, { error: 'Unauthorized.' });
  if (req.method !== 'GET' && req.method !== 'POST') return http.send(res, 405, { error: 'Method not allowed.' });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return http.send(res, 200, { ok: true, skipped: 'Email is not configured.' });

  try {
    const [accountRaw, scheduleRaw, submissionsRaw, mailRaw] = await Promise.all([
      auth.loadAuth(),
      store.read('schedule'),
      store.read('submissions'),
      store.read('mail')
    ]);
    const account = auth.normalizeAuth(accountRaw);
    const roster = normalizeRoster(scheduleRaw.roster);
    const salt = Number.isFinite(scheduleRaw.salt) ? scheduleRaw.salt >>> 0 : 0;
    const submissions = normalizeSubmissions(submissionsRaw);
    const mail = mailRaw && typeof mailRaw === 'object' && mailRaw.sent && typeof mailRaw.sent === 'object' ? mailRaw : { sent: {} };
    const weekKey = rotation.weekKeyFor(new Date());
    const thursday = new Date(weekKey + 'T00:00:00Z');
    const assigned = rotation.assignments(roster, salt, thursday);
    const day = new Date().getUTCDay();
    let sent = 0;

    if (day === 1 && !mail.sent['monday:' + weekKey]) {
      const byDesigner = new Map();
      for (const item of assigned) {
        if (!item.name) continue;
        const user = findUser(account, item.name);
        if (!user) continue;
        if (!byDesigner.has(user.id)) byDesigner.set(user.id, { user, posters: [] });
        byDesigner.get(user.id).posters.push(item.poster);
      }
      for (const entry of byDesigner.values()) {
        sent += await sendDesignerMail(
          entry.user,
          `Your graphics assignments for week ${weekKey}`,
          `Hello ${entry.user.name},\n\nYou are assigned to these posters this week:\n${entry.posters.map(p => '- ' + p).join('\n')}\n\nThey are due on Thursday ${weekKey}. Upload your work to WeTransfer and submit the link in Graphics Scheduler.`
        );
      }
      mail.sent['monday:' + weekKey] = true;
    }

    if (day === 3 && !mail.sent['wednesday:' + weekKey]) {
      const pending = submissions.filter(s => s.weekKey === weekKey && s.status === 'pending');
      const pendingByUser = new Set(pending.map(s => s.userId));
      for (const item of assigned) {
        if (!item.name) continue;
        const user = findUser(account, item.name);
        if (!user || pendingByUser.has(user.id)) continue;
        sent += await sendDesignerMail(
          user,
          `Final day reminder: ${item.poster}`,
          `Hello ${user.name},\n\n${item.poster} is due tomorrow (Thursday ${weekKey}) and we have not received a submission. Please upload your work to WeTransfer and submit the link.`
        );
      }
      const admins = account.users.filter(u => u.active && u.role === 'admin');
      if (pending.length) {
        const lines = pending.map(s => `- ${s.designerName}: ${s.poster} (${s.weTransferUrl})`).join('\n');
        for (const admin of admins) {
          const result = await email.sendEmail(admin.email, `${pending.length} poster(s) waiting for review`, `These posters are waiting for review:\n\n${lines}\n\n${process.env.APP_URL || ''}/#submissions`);
          if (result.ok) sent++;
        }
      }
      mail.sent['wednesday:' + weekKey] = true;
    }

    await store.write('mail', mail);
    return http.send(res, 200, { ok: true, weekKey, emailsSent: sent });
  } catch (e) {
    console.error('cron failed:', e && e.message ? e.message : e);
    return http.send(res, 500, { error: 'Unable to send reminders.' });
  }
};
