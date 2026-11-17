const crypto = require('crypto');
const store = require('../lib/store');
const http = require('../lib/http');
const auth = require('../lib/auth');
const validate = require('../lib/validate');
const email = require('../lib/email');

function normalizeSubmissions(value) {
  return (Array.isArray(value) ? value : []).map(validate.cleanSubmission)
    .filter(s => s.id && s.weekKey && s.poster && s.userId && s.weTransferUrl);
}

function adminEmails(account) {
  return account.users.filter(u => u.role === 'admin' && u.active).map(u => u.email);
}

async function notifyAdmins(account, submission) {
  const recipients = adminEmails(account);
  const links = (process.env.APP_URL || '') + '/#submissions';
  const message = `A poster is waiting for review.\n\nDesigner: ${submission.designerName}\nPoster: ${submission.poster}\nWeek of: ${submission.weekKey}\nLink: ${submission.weTransferUrl}\n${submission.note ? 'Note: ' + submission.note + '\n' : ''}\nReview it here: ${links}`;
  for (const to of recipients) await email.sendEmail(to, `Poster ready for review: ${submission.poster}`, message);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let account, submissions;
  try {
    [account, submissions] = await Promise.all([auth.loadAuth(), store.read('submissions')]);
  } catch (e) {
    return http.send(res, 500, { error: 'Unable to load submissions.' });
  }
  const user = auth.currentUser(req, account);
  const all = normalizeSubmissions(submissions);

  if (req.method === 'GET') {
    const isAdmin = !!user && user.role === 'admin';
    const visible = isAdmin ? all : all.filter(s => user && s.userId === user.id);
    return http.send(res, 200, {
      submissions: visible,
      pendingCount: all.filter(s => s.status === 'pending').length,
      user: auth.publicUser(user)
    });
  }
  if (req.method !== 'POST') return http.send(res, 405, { error: 'Method not allowed.' });

  let body;
  try { body = await http.readBody(req); }
  catch (e) { return http.send(res, 400, { error: 'Invalid request.' }); }

  try {
    if (body.action === 'submit') {
      if (!user) return http.send(res, 401, { error: 'Please sign in.' });
      const week = validate.weekKey(body.weekKey);
      const poster = validate.text(body.poster, 20);
      const url = validate.weTransferUrl(body.weTransferUrl);
      if (!week || !validate.POSTERS.includes(poster) || !url) {
        return http.send(res, 400, { error: 'Choose a valid week and poster, and provide a WeTransfer link.' });
      }
      const index = all.findIndex(s => s.userId === user.id && s.weekKey === week && s.poster === poster);
      if (index >= 0 && all[index].status === 'approved') return http.send(res, 400, { error: 'This poster has already been approved.' });
      const entry = index >= 0 ? all[index] : {
        id: crypto.randomUUID(),
        userId: user.id,
        designerName: user.name,
        weekKey: week,
        poster,
        submittedAt: 0,
        reviewedAt: 0,
        reviewNote: '',
        reviewedBy: '',
        status: 'pending'
      };
      entry.designerName = user.name;
      entry.weTransferUrl = url;
      entry.note = validate.text(body.note, 600);
      entry.status = 'pending';
      entry.reviewNote = '';
      entry.reviewedAt = 0;
      entry.reviewedBy = '';
      entry.submittedAt = Date.now();
      if (index >= 0) all[index] = entry; else all.unshift(entry);
      await store.write('submissions', all);
      await notifyAdmins(account, entry);
      return http.send(res, 200, { ok: true });
    }

    if (body.action === 'review') {
      const admin = auth.requireAdmin(req, res, account);
      if (!admin) return;
      const id = validate.text(body.id, 80);
      const decision = body.decision === 'approved' ? 'approved' : body.decision === 'changes' ? 'changes' : '';
      if (!id || !decision) return http.send(res, 400, { error: 'Invalid review.' });
      const entry = all.find(s => s.id === id);
      if (!entry) return http.send(res, 404, { error: 'Submission not found.' });
      entry.status = decision;
      entry.reviewNote = validate.text(body.note, 600);
      entry.reviewedAt = Date.now();
      entry.reviewedBy = admin.name;
      await store.write('submissions', all);
      const designer = account.users.find(u => u.id === entry.userId);
      if (designer) {
        const lines = decision === 'approved'
          ? `Your poster was approved.\n\nPoster: ${entry.poster}\nWeek: ${entry.weekKey}`
          : `Your poster needs changes.\n\nPoster: ${entry.poster}\nWeek: ${entry.weekKey}\n${entry.reviewNote ? 'Note: ' + entry.reviewNote : ''}`;
        await email.sendEmail(designer.email, `Poster ${decision === 'approved' ? 'approved' : 'needs changes'}: ${entry.poster}`, lines + `\n\n${process.env.APP_URL || ''}/#submissions`);
      }
      return http.send(res, 200, { ok: true });
    }

    if (body.action === 'withdraw') {
      if (!user) return http.send(res, 401, { error: 'Please sign in.' });
      const id = validate.text(body.id, 80);
      const index = all.findIndex(s => s.id === id && s.userId === user.id);
      if (index < 0) return http.send(res, 404, { error: 'Submission not found.' });
      if (all[index].status === 'approved') return http.send(res, 400, { error: 'Approved posters cannot be withdrawn.' });
      all.splice(index, 1);
      await store.write('submissions', all);
      return http.send(res, 200, { ok: true });
    }

    return http.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('submission action failed:', e && e.message ? e.message : e);
    return http.send(res, 500, { error: 'Unable to save submission.' });
  }
};
