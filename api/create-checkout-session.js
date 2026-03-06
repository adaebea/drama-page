const {
  normalizeEmail,
  recordEmailLead,
  reserveNextCode,
  attachSessionToCode,
  releaseReservedCode,
} = require('./_lib/checkout-store');
const { createCheckoutSession } = require('./_lib/stripe');

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return req.body;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const body = getBody(req);
  const email = normalizeEmail(body.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }

  let reservedCode = null;
  try {
    await recordEmailLead(email, { source: 'email-modal' });
    reservedCode = await reserveNextCode(email);
  } catch (error) {
    res.status(503).json({
      error: 'Checkout is busy right now. Please retry in a moment.',
      details: String(error.message || error),
    });
    return;
  }

  if (!reservedCode) {
    res.status(409).json({ error: 'Kalos redemption codes are currently out of stock.' });
    return;
  }

  try {
    const session = await createCheckoutSession(req, {
      email,
      code: reservedCode.code,
    });

    const attached = await attachSessionToCode(reservedCode.code, session.id);
    if (!attached) {
      await releaseReservedCode(reservedCode.code);
      res.status(500).json({
        error: 'Payment session created, but code linking failed. Please contact support.',
        details: 'Unable to attach Stripe session id to reserved code.',
      });
      return;
    }

    res.status(200).json({
      ok: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    await releaseReservedCode(reservedCode.code);
    res.status(500).json({
      error: 'Unable to create Stripe checkout session.',
      details: String(error.message || error),
    });
  }
};
