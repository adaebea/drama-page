const { deliverCodeForSession } = require('./_lib/checkout-store');
const { retrieveCheckoutSession } = require('./_lib/stripe');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const sessionId = String(req.query?.session_id || '').trim();
  if (!sessionId) {
    res.status(400).json({ error: 'Missing session_id.' });
    return;
  }

  try {
    const session = await retrieveCheckoutSession(sessionId);
    const isPaid = session.payment_status === 'paid' || session.status === 'complete';

    if (!isPaid) {
      res.status(402).json({ error: 'Payment has not completed yet.' });
      return;
    }

    const deliveredCode = await deliverCodeForSession(sessionId);
    if (!deliveredCode) {
      res.status(404).json({ error: 'No Kalos code is linked to this payment session.' });
      return;
    }

    res.status(200).json({
      ok: true,
      code: deliveredCode.code,
      email:
        session.customer_details?.email ||
        session.customer_email ||
        deliveredCode.email ||
        '',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to verify Stripe payment session.',
      details: String(error.message || error),
    });
  }
};
