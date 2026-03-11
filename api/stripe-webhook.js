const crypto = require('node:crypto');
const { hasReportedPurchase, recordReportedPurchase } = require('./_lib/checkout-store');

const CHECKOUT_CONTENT_NAME = 'Unlock the ending';
const DEFAULT_CURRENCY = 'USD';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function parseStripeSignature(header = '') {
  const parts = header.split(',').map((part) => part.trim());
  let timestamp = null;
  const signatures = [];

  parts.forEach((part) => {
    const [key, value] = part.split('=');
    if (!key || !value) return;
    if (key === 't') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) timestamp = parsed;
    }
    if (key === 'v1') {
      signatures.push(value);
    }
  });

  return { timestamp, signatures };
}

function timingSafeEquals(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isStripeSignatureValid(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;

  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  return signatures.some((sig) => timingSafeEquals(sig, expected));
}

async function readRawBody(req) {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    if (typeof req.body === 'object') {
      throw new Error('Stripe webhook requires raw body. Disable JSON body parsing for this route.');
    }
  }

  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function fetchStripeCustomerEmail(customerId) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || !customerId) return '';

  try {
    const response = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });
    const result = await response.json();
    if (!response.ok) return '';
    return result.email || '';
  } catch (error) {
    return '';
  }
}

async function sendMetaPurchaseEvent({ eventId, email, value, currency }) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';

  if (!pixelId || !accessToken) {
    return { ok: false, error: 'Missing META_PIXEL_ID or META_ACCESS_TOKEN' };
  }

  const userData = {};
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    userData.em = [sha256(normalizedEmail)];
  }

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system_generated',
        event_id: eventId,
        user_data: userData,
        custom_data: {
          value,
          currency,
          content_name: CHECKOUT_CONTENT_NAME,
        },
      },
    ],
  };

  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const graphUrl = new URL(`https://graph.facebook.com/${apiVersion}/${pixelId}/events`);
  graphUrl.searchParams.set('access_token', accessToken);

  try {
    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      return { ok: false, error: 'Meta CAPI request failed', details: result };
    }

    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: 'Meta CAPI network error', details: String(error) };
  }
}

function invoiceMatchesPrice(invoice, priceId) {
  if (!priceId) return true;
  const lines = invoice?.lines?.data || [];
  return lines.some((line) => line?.price?.id === priceId);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });
    return;
  }

  const signatureHeader = String(req.headers['stripe-signature'] || '');
  let rawBody = null;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read raw webhook body' });
    return;
  }

  if (!isStripeSignatureValid(rawBody, signatureHeader, webhookSecret)) {
    res.status(400).json({ error: 'Invalid Stripe signature' });
    return;
  }

  let event = null;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    res.status(400).json({ error: 'Invalid Stripe event payload' });
    return;
  }

  if (event.type !== 'invoice.payment_succeeded') {
    res.status(200).json({ ok: true, ignored: event.type });
    return;
  }

  const invoice = event.data?.object || {};
  const amountPaid = Number(invoice.amount_paid || 0) / 100;
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    res.status(200).json({ ok: true, skipped: 'zero_amount' });
    return;
  }

  if (!invoiceMatchesPrice(invoice, process.env.STRIPE_PRICE_ID)) {
    res.status(200).json({ ok: true, skipped: 'price_mismatch' });
    return;
  }

  const subscriptionId = invoice.subscription || '';
  const invoiceId = invoice.id || '';

  if (await hasReportedPurchase({ subscriptionId, invoiceId })) {
    res.status(200).json({ ok: true, skipped: 'already_reported' });
    return;
  }

  let email =
    invoice.customer_email ||
    invoice.customer_details?.email ||
    '';

  if (!email && invoice.customer) {
    email = await fetchStripeCustomerEmail(invoice.customer);
  }

  const currency = invoice.currency ? String(invoice.currency).toUpperCase() : DEFAULT_CURRENCY;
  const eventId = invoiceId ? `Purchase_${invoiceId}` : `Purchase_${event.id}`;

  const metaResult = await sendMetaPurchaseEvent({
    eventId,
    email,
    value: Number(amountPaid.toFixed(2)),
    currency,
  });

  if (!metaResult.ok) {
    res.status(500).json({ error: metaResult.error, details: metaResult.details || null });
    return;
  }

  await recordReportedPurchase({
    subscriptionId,
    invoiceId,
    email,
    amount: Number(amountPaid.toFixed(2)),
    currency,
  });

  res.status(200).json({ ok: true, reported: true });
};
