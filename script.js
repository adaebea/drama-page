// ==================== Pixel 常量 ====================
const CHECKOUT_VALUE = 12.99;
const CHECKOUT_CURRENCY = 'USD';
const CHECKOUT_CONTENT_NAME = 'Unlock the ending';
const META_CAPI_ENDPOINT = '/api/meta-capi';
const CREATE_CHECKOUT_SESSION_ENDPOINT = '/api/create-checkout-session';

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

function getSessionKey(key) {
  return `meta_pixel:${key}`;
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

function trackMeta(eventName, params = {}, options = {}) {
  const { custom = false, onceKey = '', server = false, email = '' } = options;
  if (onceKey && hasTrackedOnce(onceKey)) return;

  const eventId = `${eventName}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  if (typeof window.fbq === 'function') {
    if (custom) {
      window.fbq('trackCustom', eventName, params, { eventID: eventId });
    } else {
      window.fbq('track', eventName, params, { eventID: eventId });
    }
  }

  if (server) {
    sendMetaCapiEvent({
      event_name: eventName,
      event_id: eventId,
      custom_data: params,
      event_source_url: window.location.href,
      fbp: readCookie('_fbp'),
      fbc: getFbcValue(),
      em: email,
      custom_event: custom,
    });
  }

  if (onceKey) {
    markTrackedOnce(onceKey);
  }
}

function readCookie(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function getFbcValue() {
  const cookieFbc = readCookie('_fbc');
  if (cookieFbc) return cookieFbc;

  const fbclid = new URLSearchParams(window.location.search).get('fbclid');
  if (!fbclid) return '';

  return `fb.1.${Date.now()}.${fbclid}`;
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

  try {
    fetch(META_CAPI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Ignore network errors in client to avoid affecting UX.
    });
  } catch (error) {
    // Ignore synchronous fetch init errors to avoid affecting UX.
  }
}

function initPurchaseTrackingFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('purchase') !== '1') return;

  const rawValue = Number(params.get('value'));
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : CHECKOUT_VALUE;
  const rawCurrency = params.get('currency');
  const currency = rawCurrency ? rawCurrency.toUpperCase() : CHECKOUT_CURRENCY;

  trackMeta(
    'Purchase',
    {
      value,
      currency,
      content_name: CHECKOUT_CONTENT_NAME,
    },
    { onceKey: `purchase:${window.location.search}`, server: true }
  );
}

function initPolicyLinkTracking() {
  const policyLinks = document.querySelectorAll(
    'a[href="terms.html"], a[href="privacy.html"], a[href="instructions.html"]'
  );

  policyLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const sectionClass =
        link.closest('.menu-overlay, .contact-info, .modal-agreement')?.className || 'unknown';
      trackMeta(
        'PolicyLinkClick',
        {
          href: link.getAttribute('href'),
          section: sectionClass,
        },
        { custom: true }
      );
    });
  });
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  initPurchaseTrackingFromQuery();
  initScrollAnimations();
  initPageIndicator();
  initNavbar();
  initCTAButton();
  initMenuOverlay();
  initHeroCarousel();
  initSpinWheel();
  initPolicyLinkTracking();
});

// ==================== 滚动动画 ====================
function initScrollAnimations() {
  const pages = document.querySelectorAll('.page');
  const pageContents = document.querySelectorAll('.page-content');

  if (pages.length === 0) return;

  // Intersection Observer 配置
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.5,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const content = entry.target.querySelector('.page-content');
      if (entry.isIntersecting && content) {
        content.classList.add('visible');
        updateActiveIndicator(entry.target.dataset.page);
      }
    });
  }, observerOptions);

  // 观察所有页面
  pages.forEach((page) => observer.observe(page));

  // 首屏立即显示
  if (pageContents[0]) {
    pageContents[0].classList.add('visible');
  }
}

// ==================== 页面指示器 ====================
function initPageIndicator() {
  const dots = document.querySelectorAll('.dot');
  if (dots.length === 0) return;

  const scrollContainer = document.querySelector('.scroll-container');

  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const targetPage = dot.dataset.target;
      const targetSection = document.querySelector(`[data-page="${targetPage}"]`);

      if (targetSection) {
        trackMeta(
          'PageIndicatorClick',
          {
            target_page: targetPage,
          },
          { custom: true }
        );
        targetSection.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    });
  });
}

function updateActiveIndicator(pageNumber) {
  const dots = document.querySelectorAll('.dot');
  dots.forEach((dot) => {
    if (dot.dataset.target === pageNumber) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

// ==================== 导航栏滚动效果 ====================
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const scrollContainer = document.querySelector('.scroll-container');

  if (!scrollContainer || !navbar) return;

  let lastScrollTop = 0;

  scrollContainer.addEventListener(
    'scroll',
    () => {
      const scrollTop = scrollContainer.scrollTop;

      // 滚动超过100px时添加背景
      if (scrollTop > 100) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }

      lastScrollTop = scrollTop;
    },
    { passive: true }
  );
}

// ==================== CTA 按钮交互 ====================
function initCTAButton() {
  const ctaButton = document.querySelector('.cta-button');
  const modal = document.querySelector('#emailModal');

  if (ctaButton) {
    ctaButton.addEventListener('click', () => {
      trackMeta('AddToCart', {
        value: CHECKOUT_VALUE,
        currency: CHECKOUT_CURRENCY,
        content_name: CHECKOUT_CONTENT_NAME,
      }, { server: true });
      trackMeta(
        'CTAButtonClick',
        {
          location: 'bottom_cta',
        },
        { custom: true }
      );

      // 显示弹窗
      if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // 禁止背景滚动
        trackMeta(
          'EmailModalOpen',
          {
            source: 'bottom_cta',
          },
          { custom: true }
        );
      }
    });
  }

  // 初始化弹窗逻辑
  initModal();
}

// ==================== 弹窗交互 ====================
function initModal() {
  const modal = document.querySelector('#emailModal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.modal-close');
  const modalContent = modal.querySelector('.modal-content');
  const submitBtn = modal.querySelector('.modal-submit-btn');
  const emailInput = modal.querySelector('.modal-input');
  const errorMsg = modal.querySelector('.input-error-msg');
  const agreementCheckbox = modal.querySelector('#agreement');

  const showError = (message) => {
    if (errorMsg) {
      errorMsg.textContent = message;
      errorMsg.style.display = 'block';
    }
  };

  const hideError = () => {
    if (errorMsg) {
      errorMsg.style.display = 'none';
    }
  };

  const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const setSubmitting = (isSubmitting) => {
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.classList.toggle('is-loading', isSubmitting);
    const buttonText = submitBtn.querySelector('.btn-text');
    const buttonSubtext = submitBtn.querySelector('.btn-subtext');

    if (buttonText) {
      buttonText.textContent = isSubmitting ? 'Redirecting to Stripe...' : 'Continue to payment';
    }

    if (buttonSubtext) {
      buttonSubtext.textContent = isSubmitting
        ? 'Please wait a moment'
        : 'No spam · Cancel Anytime';
    }
  };

  // 关闭弹窗函数
  const closeModal = () => {
    modal.classList.remove('active');
    document.body.style.overflow = ''; // 恢复背景滚动
  };

  // 点击关闭按钮
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      trackMeta(
        'EmailModalClose',
        {
          reason: 'close_button',
        },
        { custom: true }
      );
      closeModal();
    });
  }

  // 点击遮罩层关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      trackMeta(
        'EmailModalClose',
        {
          reason: 'backdrop',
        },
        { custom: true }
      );
      closeModal();
    }
  });

  // 阻止点击内容区域关闭
  if (modalContent) {
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // 提交按钮交互
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      // 简单的点击反馈
      submitBtn.style.transform = 'scale(0.95)';
      setTimeout(async () => {
        submitBtn.style.transform = '';
        hideError();
        const email = emailInput?.value.trim() || '';

        if (!validateEmail(email)) {
          showError('Please enter a valid email address');
          return;
        }

        if (agreementCheckbox && !agreementCheckbox.checked) {
          showError('Please agree to the Privacy Policy and Terms of Service');
          return;
        }

        setSubmitting(true);

        try {
          trackMeta(
            'InitiateCheckout',
            {
              value: CHECKOUT_VALUE,
              currency: CHECKOUT_CURRENCY,
              content_name: CHECKOUT_CONTENT_NAME,
            },
            { server: true }
          );
          trackMeta(
            'Lead',
            {
              content_name: 'Email Submit',
            },
            { server: true, email }
          );

          const response = await fetch(CREATE_CHECKOUT_SESSION_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email }),
          });

          const result = await readJsonSafely(response);
          if (!response.ok || !result.url) {
            throw new Error(
              result.error ||
                'Unable to start checkout. Make sure the local API server and Stripe env vars are configured.'
            );
          }

          window.location.href = result.url;
        } catch (error) {
          showError(error.message || 'Unable to start checkout. Please try again.');
          setSubmitting(false);
        }
      }, 150);
    });
  }

  if (emailInput) {
    emailInput.addEventListener('input', () => {
      hideError();
    });
  }
}

// ==================== 触摸优化 ====================
let touchStartY = 0;
let touchEndY = 0;

document.addEventListener(
  'touchstart',
  (e) => {
    touchStartY = e.changedTouches[0].screenY;
  },
  { passive: true }
);

document.addEventListener(
  'touchend',
  (e) => {
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  },
  { passive: true }
);

function handleSwipe() {
  const swipeThreshold = 50;
  const diff = touchStartY - touchEndY;

  // 向上滑动
  if (diff > swipeThreshold) {
    // 滚动行为已由 CSS scroll-snap 处理
  }
  // 向下滑动
  else if (diff < -swipeThreshold) {
    // 滚动行为已由 CSS scroll-snap 处理
  }
}

// ==================== 性能优化：图片懒加载 ====================
if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          imageObserver.unobserve(img);
        }
      }
    });
  });

  // 如果需要懒加载，可以将 img src 改为 data-src
  // const lazyImages = document.querySelectorAll('img[data-src]');
  // lazyImages.forEach(img => imageObserver.observe(img));
}

// ==================== 防止过度滚动 ====================
const scrollContainer = document.querySelector('.scroll-container');
if (scrollContainer) {
  scrollContainer.addEventListener(
    'scroll',
    function (e) {
      // 防止橡皮筋效果（iOS）
      const scrollTop = this.scrollTop;
      const scrollHeight = this.scrollHeight;
      const clientHeight = this.clientHeight;

      if (scrollTop === 0) {
        this.scrollTop = 1;
      } else if (scrollTop + clientHeight >= scrollHeight) {
        this.scrollTop = scrollHeight - clientHeight - 1;
      }
    },
    { passive: true }
  );
}

// ==================== 全屏菜单交互 ====================
function initMenuOverlay() {
  const menuBtn = document.querySelector('.menu-btn');
  const menuOverlay = document.querySelector('#menuOverlay');

  if (!menuBtn || !menuOverlay) return;

  const toggleMenu = (show) => {
    if (show) {
      menuOverlay.classList.add('active');
      document.body.style.overflow = 'hidden'; // Prevent scrolling
      trackMeta(
        'MenuOpen',
        {
          location: 'navbar',
        },
        { custom: true }
      );
    } else {
      menuOverlay.classList.remove('active');
      document.body.style.overflow = ''; // Restore scrolling
      trackMeta(
        'MenuClose',
        {
          location: 'navbar',
        },
        { custom: true }
      );
    }
  };

  // Open menu
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Avoid bubbling issues
    if (menuOverlay.classList.contains('active')) {
      toggleMenu(false);
    } else {
      toggleMenu(true);
    }
  });

  // Close when clicking overlay (background)
  menuOverlay.addEventListener('click', (e) => {
    if (e.target === menuOverlay) {
      toggleMenu(false);
    }
  });

  // Close when clicking a link
  menuOverlay.querySelectorAll('.menu-link').forEach((link) => {
    link.addEventListener('click', () => {
      trackMeta(
        'MenuLinkClick',
        {
          href: link.getAttribute('href'),
        },
        { custom: true }
      );
      toggleMenu(false);
    });
  });
}

// ==================== 首屏轮播 ====================
function initHeroCarousel() {
  const slides = document.querySelectorAll('.hero-slide');
  if (!slides || slides.length === 0) return;

  let currentIndex = 0;
  const intervalTime = 3000; // 3 seconds

  const rotate = () => {
    // Current slide: remove active
    slides[currentIndex].classList.remove('active');

    // Next slide
    currentIndex = (currentIndex + 1) % slides.length;

    // New slide: add active
    slides[currentIndex].classList.add('active');
  };

  // Start rotation
  setInterval(rotate, intervalTime);
}

// ==================== 转盘逻辑 ====================
function initSpinWheel() {
  const spinModal = document.getElementById('spinModal');
  const spinBtn = document.getElementById('spinBtn');
  const wheel = document.getElementById('luckyWheel');
  const closeBtn = spinModal ? spinModal.querySelector('.spin-close') : null;

  if (!spinModal || !spinBtn || !wheel) return;

  // 8秒后自动弹出
  setTimeout(() => {
    // 仅当没有其他弹窗打开时弹出
    if (
      !document.querySelector('.modal-overlay.active') &&
      !document.querySelector('.menu-overlay.active')
    ) {
      spinModal.classList.add('active');
      document.body.style.overflow = 'hidden';
      trackMeta(
        'SpinWheelModalShown',
        {
          trigger: 'timer',
        },
        { custom: true, onceKey: 'spin_modal_shown' }
      );
    }
  }, 5000);

  // 关闭逻辑
  const closeSpin = () => {
    spinModal.classList.remove('active');
    document.body.style.overflow = '';
    trackMeta(
      'SpinWheelModalClose',
      {
        reason: 'close',
      },
      { custom: true }
    );
  };

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSpin);
  }

  // 点击转盘
  spinBtn.addEventListener('click', () => {
    // 防止重复点击
    if (spinBtn.disabled) return;
    spinBtn.disabled = true;

    // 目标：FREE (索引 0, 3, 6)
    // 对应的角度中心：20deg, 140deg, 260deg
    // 指针在0deg (12点钟)。
    // 要让某角度转到0deg，需要旋转：-角度。
    // 比如要让260deg转到0deg，需要转 -260deg (或 +100deg)。
    // 目标旋转角度 (mod 360) 候选: 340 (对应20), 220 (对应140), 100 (对应260)
    const targets = [100, 220, 340];
    const randomTarget = targets[Math.floor(Math.random() * targets.length)];

    // 旋转圈数 (至少5圈)
    const spins = 5;
    // 添加随机偏移 (±15deg) 以增加真实感
    const jitter = Math.floor(Math.random() * 30) - 15;

    const totalDegrees = spins * 360 + randomTarget + jitter;

    wheel.style.transform = `rotate(${totalDegrees}deg)`;

    trackMeta(
      'SpinWheelClick',
      {
        location: 'spin_modal',
      },
      { custom: true }
    );

    // 动画结束后 (4s) 可以添加庆祝效果或自动跳转
    setTimeout(() => {
      // 触发彩屑动画
      if (typeof confetti === 'function') {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          zIndex: 2200, // 必须高于转盘遮罩层 (2100)
        });
      }

      // 停留2秒后自动弹出邮箱弹窗
      setTimeout(() => {
        spinModal.classList.remove('active');
        const emailModal = document.getElementById('emailModal');
        if (emailModal) {
          emailModal.classList.add('active');
          document.body.style.overflow = 'hidden';
          trackMeta(
            'EmailModalOpen',
            {
              source: 'spin_wheel',
            },
            { custom: true }
          );
        }
      }, 2000);
    }, 4000);
  });
}
