(function () {
  const META_CONFIG_ENDPOINT = '/api/meta-config';
  const META_SDK_URL = 'https://connect.facebook.net/en_US/fbevents.js';

  function ensureFbqStub() {
    if (typeof window.fbq === 'function') return;

    const fbq = function () {
      fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };

    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    window.fbq = fbq;

    if (document.querySelector('script[data-meta-pixel-sdk="1"]')) return;

    const script = document.createElement('script');
    script.async = true;
    script.src = META_SDK_URL;
    script.dataset.metaPixelSdk = '1';
    document.head.appendChild(script);
  }

  async function initMetaPixel() {
    try {
      const response = await fetch(META_CONFIG_ENDPOINT, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      const pixelId = String(result.pixelId || '').trim();
      if (!response.ok || !pixelId) return;

      ensureFbqStub();
      window.__META_PIXEL_ID__ = pixelId;
      window.fbq('init', pixelId);
      window.fbq('track', 'PageView');
    } catch (error) {
      // Ignore pixel boot failures so the page can continue to function.
    }
  }

  initMetaPixel();
})();
