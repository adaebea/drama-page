const REDEEM_SESSION_ENDPOINT = '/api/redeem-session';
const downloadButton = document.querySelector('.success-download-btn');
let toastTimer = null;

async function readJsonSafely(response) {
  const rawText = await response.text();
  if (!rawText) return {};

  try {
    return JSON.parse(rawText);
  } catch (error) {
    return {
      error: rawText.startsWith('<')
        ? 'API endpoint is unavailable. Start the local server instead of opening the HTML file directly.'
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
    setStatus('Missing Stripe session. Please contact support.', true);
    if (codeDisplay) codeDisplay.textContent = 'Code unavailable';
    return;
  }

  try {
    const response = await fetch(
      `${REDEEM_SESSION_ENDPOINT}?session_id=${encodeURIComponent(sessionId)}`
    );
    const result = await readJsonSafely(response);

    if (!response.ok || !result.code) {
      throw new Error(result.details || result.error || 'Unable to retrieve your Kalos code.');
    }

    if (codeDisplay) {
      codeDisplay.textContent = result.code;
      codeDisplay.dataset.code = result.code;
    }

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
    setStatus(error.message || 'Unable to verify this payment session.', true);
  }
}

if (downloadButton) {
  downloadButton.addEventListener('click', () => {
    setStatus('Kalos opens in a new tab. Keep your code for redemption.');
  });
}

loadRedemptionCode();
