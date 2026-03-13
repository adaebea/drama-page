const REDEEM_SESSION_ENDPOINT = '/api/redeem-session';
const META_CAPI_ENDPOINT = '/api/meta-capi';
const CHECKOUT_VALUE = 12.99;
const CHECKOUT_CURRENCY = 'USD';
const CHECKOUT_CONTENT_NAME = 'Unlock the ending';
const COMPLETED_PURCHASE_KEY = 'perk_hub:completed_purchase';
const downloadButton = document.querySelector('.success-download-btn');
let toastTimer = null;

function getSessionKey(key) {
  return `meta_pixel:${key}`;
}

function getLocalKey(key) {
  return `meta_pixel:local:${key}`;
}

function readLocalValue(key) {
  try {
    return localStorage.getItem(getLocalKey(key)) || '';
  } catch (error) {
    return '';
  }
}

function storeLocalValue(key, value) {
  if (!value) return;
  try {
    localStorage.setItem(getLocalKey(key), String(value));
  } catch (error) {
    // Ignore storage errors.
  }
}

function hasTrackedOnce(key) {
  try {
    return sessionStorage.getItem(getSessionKey(key)) === '1';
  } catch (error) {
    return false;
  }
}

function markTrackedOnce(key) {
  try {
    sessionStorage.setItem(getSessionKey(key), '1');
  } catch (error) {
    // Ignore storage errors to avoid blocking user journey.
  }
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rememberCompletedPurchase({ sessionId, email = '', value, currency }) {
  if (!sessionId) return;
  try {
    const payload = {
      sessionId,
      email,
      value,
      currency,
      at: Date.now(),
    };
    localStorage.setItem(COMPLETED_PURCHASE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore storage errors to avoid blocking user journey.
  }
}

function readCookie(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function getFbpValue() {
  const cookieFbp = readCookie('_fbp');
  if (cookieFbp) {
    storeLocalValue('fbp', cookieFbp);
    return cookieFbp;
  }
  return readLocalValue('fbp');
}

function getFbcValue() {
  const cookieFbc = readCookie('_fbc');
  if (cookieFbc) {
    storeLocalValue('fbc', cookieFbc);
    return cookieFbc;
  }

  const fbclid = new URLSearchParams(window.location.search).get('fbclid');
  if (fbclid) {
    const value = `fb.1.${Date.now()}.${fbclid}`;
    storeLocalValue('fbc', value);
    return value;
  }

  return readLocalValue('fbc');
}

function getFbLoginId() {
  const params = new URLSearchParams(window.location.search);
  const loginId =
    params.get('fb_login_id') ||
    params.get('login_id') ||
    '';

  if (loginId) {
    storeLocalValue('fb_login_id', loginId);
    return loginId;
  }

  return readLocalValue('fb_login_id');
}

function sendMetaCapiEvent(payload) {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      const ok = navigator.sendBeacon(META_CAPI_ENDPOINT, blob);
      if (ok) return;
    } catch (error) {
      // Fall through to fetch.
    }
  }

  fetch(META_CAPI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Ignore network errors in client to avoid affecting UX.
  });
}

function trackStartTrial({ sessionId, email = '', value = CHECKOUT_VALUE, currency = CHECKOUT_CURRENCY }) {
  const onceKey = `start_trial:${sessionId || window.location.search}`;
  if (hasTrackedOnce(onceKey)) return;

  const eventId = sessionId
    ? `StartTrial_${hashString(sessionId)}`
    : `StartTrial_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const params = {
    value,
    currency,
    content_name: CHECKOUT_CONTENT_NAME,
  };

  if (typeof window.fbq === 'function') {
    window.fbq('track', 'StartTrial', params, { eventID: eventId });
  }

  sendMetaCapiEvent({
    event_name: 'StartTrial',
    event_id: eventId,
    custom_data: params,
    event_source_url: window.location.href,
    fbp: getFbpValue(),
    fbc: getFbcValue(),
    fb_login_id: getFbLoginId(),
    em: email,
  });

  markTrackedOnce(onceKey);
}

async function readJsonSafely(response) {
  const rawText = await response.text();
  if (!rawText) return {};

  try {
    return JSON.parse(rawText);
  } catch (error) {
    return {
      error: rawText.startsWith('<')
        ? 'The service is currently unavailable. Please try again later.'
        : rawText,
    };
  }
}

function setStatus(message, isError = false) {
  const status = document.querySelector('#successStatus');
  if (!status) return;

  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function showToast(message) {
  const toast = document.querySelector('#successToast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('is-visible');

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 2200);
}

function getRedeemErrorMessage(status) {
  if (status === 400) return 'The order information is invalid. Please return from the payment result page.';
  if (status === 402) return 'Payment has not completed yet. Please refresh this page shortly.';
  if (status === 404) return 'No redemption code was found yet. Please refresh later or contact support.';
  if (status >= 500) return 'The service is temporarily unavailable. Please try again later.';
  return 'Unable to retrieve the redemption code at this time. Please try again later.';
}

function lockBackNavigation() {
  if (!window.history || typeof window.history.pushState !== 'function') return;

  window.history.pushState({ success: true }, '', window.location.href);
  window.addEventListener('popstate', () => {
    window.location.replace('/');
  });
}

function launchSuccessConfetti() {
  if (typeof window.confetti !== 'function') return;

  window.confetti({
    particleCount: 140,
    spread: 78,
    startVelocity: 40,
    origin: { y: 0.35 },
    colors: ['#ffe066', '#ffbf00', '#ffffff', '#7dd3fc'],
  });
}

async function copyCode() {
  const codeDisplay = document.querySelector('#codeDisplay');
  const copyHint = document.querySelector('#copyHint');
  const code = codeDisplay?.dataset.code || '';

  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    if (copyHint) {
      copyHint.textContent = 'Copied. Keep this code and use it inside Kalos.';
    }
    showToast('Code copied');
  } catch (error) {
    if (copyHint) {
      copyHint.textContent = 'Copy failed. Please long-press or select the code manually.';
    }
    showToast('Copy failed');
  }
}

async function loadRedemptionCode() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const codeDisplay = document.querySelector('#codeDisplay');
  const copyButton = document.querySelector('#copyCodeBtn');

  if (!sessionId) {
    setStatus('Order information is missing. Please return from the payment result page.', true);
    if (codeDisplay) codeDisplay.textContent = 'Code unavailable';
    return;
  }

  try {
    const response = await fetch(
      `${REDEEM_SESSION_ENDPOINT}?session_id=${encodeURIComponent(sessionId)}`
    );
    const result = await readJsonSafely(response);

    if (!response.ok || !result.code) {
      throw new Error(getRedeemErrorMessage(response.status));
    }

    if (codeDisplay) {
      codeDisplay.textContent = result.code;
      codeDisplay.dataset.code = result.code;
    }

    trackStartTrial({
      sessionId,
      email: result.email || '',
      value: Number.isFinite(Number(result.value)) && Number(result.value) > 0 ? Number(result.value) : CHECKOUT_VALUE,
      currency: result.currency || CHECKOUT_CURRENCY,
    });

    rememberCompletedPurchase({
      sessionId,
      email: result.email || '',
      value: Number.isFinite(Number(result.value)) && Number(result.value) > 0 ? Number(result.value) : CHECKOUT_VALUE,
      currency: result.currency || CHECKOUT_CURRENCY,
    });

    setStatus('Your code is ready. Copy it before opening Kalos.');
    launchSuccessConfetti();

    if (copyButton) {
      copyButton.addEventListener('click', copyCode);
    }

    if (codeDisplay) {
      codeDisplay.addEventListener('click', copyCode);
    }
  } catch (error) {
    if (codeDisplay) codeDisplay.textContent = 'Code unavailable';
    setStatus(error.message || 'Unable to verify payment details at this time. Please try again later.', true);
  }
}

if (downloadButton) {
  downloadButton.addEventListener('click', () => {
    setStatus('Kalos opens in a new tab. Keep your code for redemption.');
  });
}

lockBackNavigation();
loadRedemptionCode();
