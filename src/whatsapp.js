async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });

  const data = await res.json();

  if (!res.ok) {
    // Without this, a failed WhatsApp send (bad token, invalid number,
    // rate limit) was silently swallowed - the caller got a response body
    // back and had no idea it was actually an error.
    throw new Error(`WhatsApp API error (${res.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

module.exports = { sendWhatsAppText };
