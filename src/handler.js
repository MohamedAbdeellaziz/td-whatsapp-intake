const { Resend } = require('resend');
const { sendWhatsAppText } = require('./whatsapp');

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.]+/;

// In-memory dedup store: message.id -> true once we've handled it.
// Good enough for "runs locally" scope. A real Render deployment would
// need this in something shared/persistent (DB or Redis), because:
//   - Render can run multiple instances behind a load balancer, so one
//     instance's in-memory Set won't know what another instance already sent.
//   - A restart/redeploy wipes this Set, so a late retry after a deploy
//     could slip through.
const processedMessageIds = new Set();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function handleIncomingMessage(message, contact) {
  if (!message?.id) {
    console.error('Incoming message has no id - cannot dedupe, skipping.');
    return;
  }

  if (processedMessageIds.has(message.id)) {
    console.log(`Skipping already-processed message ${message.id}`);
    return;
  }

  const text = message.text?.body || '';
  const name = contact?.profile?.name || 'Client';
  const email = (text.match(EMAIL_REGEX) || [])[0];

  if (!email) {
    await sendWhatsAppText(message.from, 'Please send your email address so we can confirm your request.');
    return;
  }

  // Mark as processed BEFORE sending, not after. This means: if the send
  // below fails partway and Meta retries the same message, that retry will
  // be skipped (see the check above) rather than sent again. We're choosing
  // "may silently under-deliver on a rare failure" over "may double-send" -
  // because requirement (b) says a client must NEVER get the email twice,
  // it doesn't say delivery must be guaranteed. A failed send still gets
  // logged by the error handling in server.js, so it's not unobservable,
  // just not auto-retried.
  processedMessageIds.add(message.id);

  const { error } = await resend.emails.send({
    from: 'Top Delmon <onboarding@resend.dev>',
    to: email,
    subject: 'We received your request',
    html: `<p>Dear ${escapeHtml(name)},</p><p>We received your message: "${escapeHtml(text)}". Our team will contact you within one working day.</p>`,
  });

  if (error) {
    // Resend doesn't throw on failure - it returns { data: null, error }.
    // Without this check, a failed send would still fall through to telling
    // the client "a confirmation email has been sent," which is false.
    throw new Error(`Resend API error: ${error.message}`);
  }

  await sendWhatsAppText(message.from, 'Thank you. A confirmation email has been sent.');
}

module.exports = { handleIncomingMessage };
