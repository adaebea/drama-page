const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits;
}

function normalizeIp(value) {
  if (!value) return '';
  let ip = String(value).trim();
  if (!ip) return '';

  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end > 0) {
      return ip.slice(1, end);
    }
  }

  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    return ip.split(':')[0];
  }

  return ip;
}

function isIpv4(ip) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

function isIpv6(ip) {
  return ip.includes(':') && !isIpv4(ip);
}

function getClientIp(req) {
  const candidates = [];
  const headerNames = [
    'x-vercel-forwarded-for',
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'true-client-ip',
  ];

  headerNames.forEach((name) => {
    const value = req.headers[name];
    if (typeof value === 'string' && value.trim()) {
      candidates.push(...value.split(','));
    }
  });

  if (req.socket?.remoteAddress) {
    candidates.push(req.socket.remoteAddress);
  }

  const normalized = candidates
    .map((item) => normalizeIp(item))
    .filter(Boolean);

  const ipv6 = normalized.find(isIpv6);
  if (ipv6) return ipv6;

  const ipv4 = normalized.find(isIpv4);
  if (ipv4) return ipv4;

  if (normalized.length > 0) return normalized[0];
  return '';
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
  const fbLoginId = String(body.fb_login_id || body.login_id || '').trim();
  const email = normalizeEmail(body.em);
  const phone = normalizePhone(body.ph || body.phone);
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
  if (fbLoginId) userData.fb_login_id = fbLoginId;
  if (email) userData.em = [sha256(email)];
  if (phone) userData.ph = [sha256(phone)];

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
