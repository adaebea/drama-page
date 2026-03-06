const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

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

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';

  if (!pixelId || !accessToken) {
    res.status(500).json({
      error: 'Missing META_PIXEL_ID or META_ACCESS_TOKEN in environment variables',
    });
    return;
  }

  const body = getBody(req);
  const eventName = body.event_name;
  const eventId = body.event_id;
  const customData = body.custom_data || {};
  const eventSourceUrl = body.event_source_url || '';
  const fbp = body.fbp || '';
  const fbc = body.fbc || '';
  const email = normalizeEmail(body.em);
  const customEvent = Boolean(body.custom_event);

  if (!eventName || !eventId) {
    res.status(400).json({ error: 'Missing event_name or event_id' });
    return;
  }

  const userData = {
    client_ip_address: getClientIp(req),
    client_user_agent: req.headers['user-agent'] || '',
  };
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;
  if (email) userData.em = [sha256(email)];

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_id: eventId,
        event_source_url: eventSourceUrl,
        user_data: userData,
        custom_data: customData,
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
      res.status(500).json({
        error: 'Meta CAPI request failed',
        details: result,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      dedup_key: `${eventName}:${eventId}`,
      custom_event: customEvent,
      meta: result,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Meta CAPI network error',
      details: String(error),
    });
  }
};
