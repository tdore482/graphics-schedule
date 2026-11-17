function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toHtml(text) {
  return esc(text).split('\n').map(line => line ? `<p>${line}</p>` : '<p>&nbsp;</p>').join('');
}

async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: 'Email is not configured.' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [to], subject, text, html: toHtml(text) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: data.message || data.error || 'Email request failed.' };
  return { ok: true, id: data.id };
}

module.exports = { sendEmail, esc };
