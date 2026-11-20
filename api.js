const ADMIN_TOKEN_KEY = 'orva7_admin_token';
const CUSTOMER_TOKEN_KEY = 'orva7_customer_token';

function readStoredToken(key) {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStoredToken(key, token) {
  try {
    if (token) {
      sessionStorage.setItem(key, token);
      localStorage.setItem(key, token);
    } else {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage restriction
  }
}

export function getAdminToken() {
  return readStoredToken(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token) {
  writeStoredToken(ADMIN_TOKEN_KEY, token || '');
}

export function clearAdminToken() {
  writeStoredToken(ADMIN_TOKEN_KEY, '');
}

export function getCustomerToken() {
  return readStoredToken(CUSTOMER_TOKEN_KEY);
}

export function setCustomerToken(token) {
  writeStoredToken(CUSTOMER_TOKEN_KEY, token || '');
}

export function clearCustomerToken() {
  writeStoredToken(CUSTOMER_TOKEN_KEY, '');
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function apiFetch(url, options = {}) {
  const isAdminRoute = String(url).startsWith('/api/admin');
  const authToken = isAdminRoute ? getAdminToken() : getCustomerToken();

  const mergedHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (authToken && !mergedHeaders.Authorization && !mergedHeaders.authorization) {
    mergedHeaders.Authorization = `Bearer ${authToken}`;
  }

  const config = {
    credentials: 'include',
    ...options,
    headers: mergedHeaders,
  };

  const res = await fetch(url, config);
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    if (res.status === 401 && isAdminRoute && url !== '/api/admin/login') {
      clearAdminToken();
    }
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function formatPrice(amount, symbol = 'ج.م') {
  const num = Math.round(Number(amount) || 0);
  return `${num.toLocaleString('en-US')} ${symbol}`;
}

export function formatDateAr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function showToast(message, type = 'success') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  region.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3600);
}

export function getOrvaLogoSvg(size = 34, onDark = false) {
  const ring = onDark ? '#E2E7EE' : '#0A1628';
  const gold = '#C6A55C';
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="8" stroke="${ring}" stroke-width="1.75"/>
      <circle cx="17" cy="20" r="8" stroke="${ring}" stroke-width="1.75"/>
      <path d="M21 12H30L23.5 28" stroke="${gold}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

export function renderImageWithFallback(src, alt, className = '') {
  const cleanSrc = escapeHtml(src || '');
  const cleanAlt = escapeHtml(alt || 'ORVA 7');
  if (!cleanSrc) {
    return `<div class="media-fallback ${escapeHtml(className)}"><span>ORVA 7</span><span>${cleanAlt}</span></div>`;
  }
  return `
    <img
      src="${cleanSrc}"
      alt="${cleanAlt}"
      class="${escapeHtml(className)}"
      loading="lazy"
      referrerpolicy="no-referrer"
      onerror="this.outerHTML='<div class=&quot;media-fallback&quot;><span>ORVA 7</span></div>'"
    />
  `;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الملف المختار.'));
    reader.readAsDataURL(file);
  });
}

export const ORDER_STATUS_META = {
  pending: { label: 'قيد الانتظار', cls: 'status-warn' },
  confirmed: { label: 'مؤكد', cls: 'status-ok' },
  processing: { label: 'قيد التجهيز', cls: 'status-warn' },
  shipped: { label: 'تم الشحن', cls: 'status-ok' },
  completed: { label: 'مكتمل', cls: 'status-ok' },
  cancelled: { label: 'ملغي', cls: 'status-danger' },
};

export const PAYMENT_METHOD_LABELS = {
  whatsapp_cod: 'واتساب / عند الاستلام',
  online_card: 'بطاقة بنكية (ORVA Pay)',
  online_wallet: 'محفظة إلكترونية / InstaPay',
  stripe: 'بطاقة دولية (Stripe)',
};

export const PAYMENT_STATUS_META = {
  unpaid: { label: 'غير مدفوع', cls: 'status-muted' },
  pending: { label: 'قيد التحقق', cls: 'status-warn' },
  paid: { label: 'مدفوع', cls: 'status-ok' },
  failed: { label: 'فشل الدفع', cls: 'status-danger' },
  refunded: { label: 'مسترد', cls: 'status-warn' },
};

export function renderStarsHtml(average = 0, count = null) {
  const rounded = Math.round(Number(average) || 0);
  let stars = '';
  for (let i = 1; i <= 5; i += 1) {
    stars += `<span class="star-glyph ${i <= rounded ? 'is-filled' : ''}" aria-hidden="true">${i <= rounded ? '★' : '☆'}</span>`;
  }
  const avgText = Number(average) > 0 ? Number(average).toFixed(1) : '0.0';
  const countText = count !== null ? ` (${count})` : '';
  return `<span class="stars-row" aria-label="تقييم ${avgText} من 5">${stars}<span class="stars-num tabular-nums">${avgText}${countText}</span></span>`;
}

