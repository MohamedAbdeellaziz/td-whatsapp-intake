require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const { handleIncomingMessage } = require('./handler');

const app = express();

// Capture the raw request body so we can verify Meta's HMAC signature
// against the exact bytes they sent (not a re-serialized copy, which can
// differ in whitespace/key order and break the signature check).
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

function verifyMetaSignature(req) {
  const signatureHeader = req.get('x-hub-signature-256');
  const appSecret = process.env.META_APP_SECRET;

  if (!signatureHeader || !appSecret || !req.rawBody) {
    return false;
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signatureHeader);

  // Signatures must be the same length for timingSafeEqual, and a
  // mismatched length is itself just "invalid", not a crash.
  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

// Meta webhook verification (handshake when you first subscribe)
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

// Incoming WhatsApp messages
app.post('/webhook', async (req, res) => {
  if (!verifyMetaSignature(req)) {
    console.error('Rejected webhook: invalid or missing X-Hub-Signature-256');
    return res.sendStatus(403);
  }

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (message) {
      await handleIncomingMessage(message, entry.contacts?.[0]);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    // Return 500 so Meta retries. Safe to retry because handleIncomingMessage
    // checks idempotency before sending anything - a retry of an
    // already-completed message is a no-op, not a duplicate email.
    res.sendStatus(500);
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
