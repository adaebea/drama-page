function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

function buildFormBody(payload) {
  const params = new URLSearchParams();

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.append(key, String(value));
  });

  return params;
}

async function createCheckoutSession(req, { email, code }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const mode = process.env.STRIPE_CHECKOUT_MODE || 'payment';

  if (!secretKey || !priceId) {
    throw new Error('Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID');
  }

  const baseUrl = getBaseUrl(req);
  const payload = {
    mode,
    success_url:
      process.env.STRIPE_SUCCESS_URL ||
      `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: process.env.STRIPE_CANCEL_URL || `${baseUrl}/`,
    customer_email: email,
    allow_promotion_codes: 'true',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    'metadata[email]': email,
    'metadata[kalos_code]': code,
    'metadata[source]': 'drama-page',
  };

  if (mode === 'subscription' && process.env.STRIPE_TRIAL_PERIOD_DAYS) {
    payload['subscription_data[trial_period_days]'] = process.env.STRIPE_TRIAL_PERIOD_DAYS;
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: buildFormBody(payload).toString(),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || 'Stripe checkout session creation failed');
  }

  return result;
}

async function retrieveCheckoutSession(sessionId) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }

  const encodedId = encodeURIComponent(sessionId);
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodedId}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || 'Stripe checkout session retrieval failed');
  }

  return result;
}

module.exports = {
  createCheckoutSession,
  retrieveCheckoutSession,
};
