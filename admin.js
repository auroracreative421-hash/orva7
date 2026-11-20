import {
  apiFetch,
  clearAdminToken,
  escapeHtml,
  formatDateAr,
  formatPrice,
  getOrvaLogoSvg,
  ORDER_STATUS_META,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_META,
  readFileAsDataUrl,
  renderImageWithFallback,
  setAdminToken,
  showToast,
} from './api.js';

const adminState = {
  authenticated: false,
  username: '',
  activeView: 'overview',
  overview: null,
  products: [],
  categories: [],
  collections: [],
  offers: [],
  homepage: null,
  orders: [],
  settings: null,
  productSearch: '',
  productFilterCat: '',
  productFilterPub: 'all',
  orderFilterStatus: 'all',
  sidebarOpen: false,
};

const VIEW_TITLES = {
  overview: 'نظرة عامة على المتجر',
  products: 'إدارة المنتجات والتسعير',
  categories: 'إدارة الفئات والتصنيفات',
  collections: 'إدارة المجموعات',
  offers: 'إدارة العروض والخصومات',
  homepage: 'محرر الصفحة الرئيسية',
  orders: 'إدارة الطلبات',
  settings: 'إعدادات المتجر والأمان',
};

function openModal(title, bodyHtml) {
  const modal = document.getElementById('admin-modal');
  const titleEl = document.getElementById('admin-modal-title');
  const bodyEl = document.getElementById('admin-modal-body');
  if (!modal || !titleEl || !bodyEl) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  if (!modal.open) modal.showModal();
}

function closeModal() {
  const modal = document.getElementById('admin-modal');
  if (modal?.open) modal.close();
}

function confirmAction(title, message, onConfirm) {
  openModal(
    title,
    `
      <p style="margin:0 0 1.25rem;color:var(--text-secondary);">${escapeHtml(message)}</p>
      <div style="display:flex;justify-content:flex-end;gap:0.65rem;">
        <button type="button" class="btn btn-secondary" id="confirm-cancel-btn">إلغاء</button>
        <button type="button" class="btn btn-danger" id="confirm-ok-btn">تأكيد الحذف</button>
      </div>
    `
  );
  document.getElementById('confirm-cancel-btn')?.addEventListener('click', closeModal);
  document.getElementById('confirm-ok-btn')?.addEventListener('click', async () => {
    closeModal();
    await onConfirm();
  });
}

async function uploadImageFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const res = await apiFetch('/api/admin/upload', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, dataUrl }),
  });
  return res.url;
}

// ==========================================
// Authentication & Login Screen
// ==========================================

function renderLoginScreen(errorMsg = '') {
  const root = document.getElementById('admin-root');
  if (!root) return;

  root.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="login-brand">
          <div style="display:flex;align-items:center;gap:0.65rem;">
            ${getOrvaLogoSvg(36, false)}
            <span class="login-wordmark">ORVA 7</span>
          </div>
          <a href="/" class="btn btn-ghost btn-sm">العودة للمتجر</a>
        </div>

        <div>
          <h1 class="login-title">تسجيل دخول الإدارة</h1>
          <p class="login-sub">بوابة خاصة لإدارة المنتجات، الفئات، العروض، والطلبات.</p>
        </div>

        <form id="admin-login-form" class="form-stack" novalidate>
          <div class="form-field">
            <label for="login-username">اسم المستخدم</label>
            <input
              id="login-username"
              name="username"
              type="text"
              class="form-control"
              autocomplete="username"
              required
              placeholder="أدخل اسم المستخدم"
            />
          </div>

          <div class="form-field">
            <label for="login-password">كلمة المرور</label>
            <input
              id="login-password"
              name="password"
              type="password"
              class="form-control"
              autocomplete="current-password"
              required
              placeholder="أدخل كلمة المرور"
            />
          </div>

          <div id="login-error-box" class="form-error-box" ${errorMsg ? '' : 'hidden'}>
            ${escapeHtml(errorMsg)}
          </div>

          <button type="submit" id="login-submit-btn" class="btn btn-primary" style="width:100%;">
            دخول إلى لوحة التحكم
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '');
    const errBox = document.getElementById('login-error-box');
    const submitBtn = document.getElementById('login-submit-btn');

    if (errBox) errBox.hidden = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'جارٍ التحقق...';
    }

    try {
      const res = await apiFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (res.token) setAdminToken(res.token);
      adminState.authenticated = true;
      adminState.username = res.username;
      await loadAllAdminData();
      renderAdminShell();
      showToast('تم تسجيل الدخول بنجاح.');
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message || 'فشل تسجيل الدخول.';
        errBox.hidden = false;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'دخول إلى لوحة التحكم';
      }
    }
  });
}

async function loadAllAdminData() {
  const [ov, pr, ca, co, of, hp, or, se] = await Promise.all([
    apiFetch('/api/admin/overview'),
    apiFetch('/api/admin/products'),
    apiFetch('/api/admin/categories'),
    apiFetch('/api/admin/collections'),
    apiFetch('/api/admin/offers'),
    apiFetch('/api/admin/homepage'),
    apiFetch('/api/admin/orders'),
    apiFetch('/api/admin/settings'),
  ]);
  adminState.overview = ov;
  adminState.products = pr.products || [];
  adminState.categories = ca.categories || [];
  adminState.collections = co.collections || [];
  adminState.offers = of.offers || [];
  adminState.homepage = hp.homepage;
  adminState.orders = or.orders || [];
  adminState.settings = se.settings;
}

// ==========================================
// Shell & Navigation
// ==========================================

function renderAdminShell() {
  const root = document.getElementById('admin-root');
  if (!root) return;

  const navItems = [
    { id: 'overview', label: 'نظرة عامة', count: null },
    { id: 'products', label: 'المنتجات', count: adminState.products.length },
    { id: 'categories', label: 'الفئات', count: adminState.categories.length },
    { id: 'collections', label: 'المجموعات', count: adminState.collections.length },
    { id: 'offers', label: 'العروض والخصومات', count: adminState.offers.length },
    { id: 'homepage', label: 'الصفحة الرئيسية', count: null },
    { id: 'orders', label: 'الطلبات', count: adminState.orders.length },
    { id: 'settings', label: 'إعدادات المتجر', count: null },
  ];

  root.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar ${adminState.sidebarOpen ? 'is-open' : ''}" id="admin-sidebar">
        <div>
          <div class="sidebar-brand">
            <div style="display:flex;align-items:center;gap:0.6rem;">
              ${getOrvaLogoSvg(30, true)}
              <span class="sidebar-wordmark">ORVA 7</span>
            </div>
            <button type="button" class="icon-btn admin-mobile-toggle" id="close-sidebar-btn" aria-label="إغلاق القائمة" style="background:transparent;color:#fff;border-color:rgba(255,255,255,0.2);">✕</button>
          </div>

          <nav class="sidebar-nav" aria-label="أقسام لوحة التحكم">
            ${navItems
              .map(
                (item) => `
              <button
                type="button"
                class="sidebar-link ${adminState.activeView === item.id ? 'is-active' : ''}"
                data-admin-nav="${item.id}"
              >
                <span>${item.label}</span>
                ${
                  item.count !== null
                    ? `<span class="tabular-nums" style="font-size:0.78rem;opacity:0.8;">${item.count}</span>`
                    : ''
                }
              </button>
            `
              )
              .join('')}
          </nav>
        </div>

        <div class="sidebar-footer">
          <a href="/" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="width:100%;">
            معاينة المتجر العام
          </a>
          <button type="button" id="admin-logout-btn" class="btn btn-ghost btn-sm" style="color:var(--silver-200);width:100%;">
            تسجيل الخروج (${escapeHtml(adminState.username)})
          </button>
        </div>
      </aside>

      <div class="admin-main">
        <header class="admin-topbar">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <button type="button" class="icon-btn admin-mobile-toggle" id="open-sidebar-btn" aria-label="فتح القائمة الجانبية">☰</button>
            <h1 class="admin-topbar-title">${VIEW_TITLES[adminState.activeView] || 'لوحة التحكم'}</h1>
          </div>
          <div class="admin-topbar-actions">
            <button type="button" id="quick-add-product-btn" class="btn btn-primary btn-sm">+ إضافة منتج</button>
          </div>
        </header>

        <main class="admin-content" id="admin-view-body"></main>
      </div>
    </div>
  `;

  document.getElementById('open-sidebar-btn')?.addEventListener('click', () => {
    adminState.sidebarOpen = true;
    document.getElementById('admin-sidebar')?.classList.add('is-open');
  });
  document.getElementById('close-sidebar-btn')?.addEventListener('click', () => {
    adminState.sidebarOpen = false;
    document.getElementById('admin-sidebar')?.classList.remove('is-open');
  });

  root.querySelectorAll('[data-admin-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminState.activeView = btn.getAttribute('data-admin-nav') || 'overview';
      adminState.sidebarOpen = false;
      renderAdminShell();
    });
  });

  document.getElementById('quick-add-product-btn')?.addEventListener('click', () => {
    openProductModal(null);
  });

  document.getElementById('admin-logout-btn')?.addEventListener('click', async () => {
    try {
      await apiFetch('/api/admin/logout', { method: 'POST' });
    } finally {
      clearAdminToken();
      adminState.authenticated = false;
      renderLoginScreen();
      showToast('تم تسجيل الخروج بأمان.');
    }
  });

  renderActiveAdminView();
}

function renderActiveAdminView() {
  const container = document.getElementById('admin-view-body');
  if (!container) return;

  switch (adminState.activeView) {
    case 'overview':
      renderOverviewView(container);
      break;
    case 'products':
      renderProductsView(container);
      break;
    case 'categories':
      renderCategoriesView(container);
      break;
    case 'collections':
      renderCollectionsView(container);
      break;
    case 'offers':
      renderOffersView(container);
      break;
    case 'homepage':
      renderHomepageEditorView(container);
      break;
    case 'orders':
      renderOrdersView(container);
      break;
    case 'settings':
      renderSettingsView(container);
      break;
    default:
      renderOverviewView(container);
  }
}

// ==========================================
// 1. Overview View
// ==========================================

function renderOverviewView(container) {
  const stats = adminState.overview?.stats || {};
  const recentOrders = adminState.overview?.recentOrders || [];
  const currency = adminState.settings?.currencySymbol || 'ج.م';

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">إجمالي المنتجات</div>
        <div class="kpi-value">${stats.totalProducts || 0}</div>
        <div class="kpi-sub">منشور بالمتجر: ${stats.publishedProducts || 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">الفئات والمجموعات</div>
        <div class="kpi-value">${stats.totalCategories || 0} / ${stats.totalCollections || 0}</div>
        <div class="kpi-sub">فئات نشطة · مجموعات</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">إجمالي الطلبات</div>
        <div class="kpi-value">${stats.totalOrders || 0}</div>
        <div class="kpi-sub">قيد الانتظار: ${stats.pendingOrders || 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">إجمالي المبيعات المسجلة</div>
        <div class="kpi-value">${escapeHtml(formatPrice(stats.totalRevenue || 0, currency))}</div>
        <div class="kpi-sub">مدفوع أونلاين: ${escapeHtml(formatPrice(stats.paidRevenue || 0, currency))} · عروض: ${stats.activeOffers || 0}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">إجراءات سريعة</h2>
      </div>
      <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:0.75rem;">
        <button type="button" class="btn btn-primary btn-sm" id="ov-add-prod">+ منتج جديد</button>
        <button type="button" class="btn btn-secondary btn-sm" id="ov-add-cat">+ فئة جديدة</button>
        <button type="button" class="btn btn-secondary btn-sm" id="ov-add-col">+ مجموعة جديدة</button>
        <button type="button" class="btn btn-secondary btn-sm" id="ov-add-offer">+ عرض خصم جديد</button>
        <button type="button" class="btn btn-secondary btn-sm" id="ov-edit-home">تخصيص الرئيسية</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">أحدث الطلبات</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="ov-view-orders">عرض جميع الطلبات</button>
      </div>
      <div class="table-scroll">
        ${
          recentOrders.length
            ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>العميل</th>
                <th>الهاتف</th>
                <th>الإجمالي</th>
                <th>الدفع</th>
                <th>حالة الطلب</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              ${recentOrders
                .map((ord) => {
                  const st = ORDER_STATUS_META[ord.status] || { label: ord.status, cls: 'status-muted' };
                  const pm = PAYMENT_STATUS_META[ord.paymentStatus] || { label: ord.paymentStatus || 'غير مدفوع', cls: 'status-muted' };
                  return `
                    <tr>
                      <td class="tabular-nums"><strong>${escapeHtml(ord.orderNumber)}</strong></td>
                      <td>${escapeHtml(ord.customerName)}</td>
                      <td class="tabular-nums">${escapeHtml(ord.customerPhone)}</td>
                      <td class="tabular-nums">${escapeHtml(formatPrice(ord.totalPrice, currency))}</td>
                      <td><span class="status-label ${pm.cls}">${pm.label}</span></td>
                      <td><span class="status-label ${st.cls}">${st.label}</span></td>
                      <td>${escapeHtml(formatDateAr(ord.createdAt))}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        `
            : `<div class="panel-body">لا توجد طلبات مسجلة حتى الآن.</div>`
        }
      </div>
    </div>
  `;

  document.getElementById('ov-add-prod')?.addEventListener('click', () => openProductModal(null));
  document.getElementById('ov-add-cat')?.addEventListener('click', () => openCategoryModal(null));
  document.getElementById('ov-add-col')?.addEventListener('click', () => openCollectionModal(null));
  document.getElementById('ov-add-offer')?.addEventListener('click', () => openOfferModal(null));
  document.getElementById('ov-edit-home')?.addEventListener('click', () => {
    adminState.activeView = 'homepage';
    renderAdminShell();
  });
  document.getElementById('ov-view-orders')?.addEventListener('click', () => {
    adminState.activeView = 'orders';
    renderAdminShell();
  });
}

// ==========================================
// 2. Products Manager
// ==========================================

function renderProductsView(container) {
  const currency = adminState.settings?.currencySymbol || 'ج.م';
  const catMap = new Map(adminState.categories.map((c) => [c.id, c.name]));

  const filtered = adminState.products.filter((p) => {
    if (adminState.productSearch.trim()) {
      const q = adminState.productSearch.trim().toLowerCase();
      if (!`${p.name} ${p.description}`.toLowerCase().includes(q)) return false;
    }
    if (adminState.productFilterCat && p.categoryId !== adminState.productFilterCat) return false;
    if (adminState.productFilterPub === 'published' && !p.isPublished) return false;
    if (adminState.productFilterPub === 'draft' && p.isPublished) return false;
    return true;
  });

  container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div style="display:flex;flex-wrap:wrap;gap:0.65rem;flex:1;">
          <input
            type="search"
            id="admin-prod-search"
            class="form-control"
            style="max-width:260px;"
            placeholder="بحث باسم المنتج..."
            value="${escapeHtml(adminState.productSearch)}"
          />
          <select id="admin-prod-cat-filter" class="form-control" style="max-width:200px;">
            <option value="">كل الفئات</option>
            ${adminState.categories
              .map(
                (c) =>
                  `<option value="${escapeHtml(c.id)}" ${adminState.productFilterCat === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
              )
              .join('')}
          </select>
          <select id="admin-prod-pub-filter" class="form-control" style="max-width:160px;">
            <option value="all" ${adminState.productFilterPub === 'all' ? 'selected' : ''}>الكل</option>
            <option value="published" ${adminState.productFilterPub === 'published' ? 'selected' : ''}>منشور فقط</option>
            <option value="draft" ${adminState.productFilterPub === 'draft' ? 'selected' : ''}>مسودة / مخفي</option>
          </select>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="add-product-btn">+ إضافة منتج جديد</button>
      </div>

      <div class="table-scroll">
        ${
          filtered.length
            ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>الصورة</th>
                <th>المنتج</th>
                <th>الفئة</th>
                <th>السعر</th>
                <th>المخزون</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((p) => {
                  const pr = p.pricing || { finalPrice: p.price, hasDiscount: false };
                  return `
                    <tr>
                      <td>
                        ${
                          p.images[0]
                            ? `<img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}" class="thumb-cell" />`
                            : `<div class="thumb-cell" style="display:grid;place-items:center;font-size:0.7rem;">ORVA</div>`
                        }
                      </td>
                      <td>
                        <strong>${escapeHtml(p.name)}</strong>
                        <div style="font-size:0.78rem;color:var(--text-muted);">
                          ${p.isFeatured ? 'مميز · ' : ''}${p.isBestSeller ? 'الأكثر مبيعاً · ' : ''}${p.isNewArrival ? 'جديد' : ''}
                        </div>
                      </td>
                      <td>${escapeHtml(catMap.get(p.categoryId) || 'غير مصنف')}</td>
                      <td class="tabular-nums">
                        <strong>${escapeHtml(formatPrice(pr.finalPrice, currency))}</strong>
                        ${pr.hasDiscount ? `<div style="font-size:0.76rem;color:var(--text-muted);text-decoration:line-through;">${escapeHtml(formatPrice(p.price, currency))}</div>` : ''}
                      </td>
                      <td class="tabular-nums">${p.stock}</td>
                      <td>
                        <button
                          type="button"
                          class="btn btn-sm ${p.isPublished ? 'status-ok' : 'status-muted'}"
                          data-toggle-publish="${escapeHtml(p.id)}"
                          data-next-pub="${!p.isPublished}"
                          style="border:1px solid var(--border-hairline);"
                        >
                          ${p.isPublished ? 'منشور' : 'مخفي'}
                        </button>
                      </td>
                      <td>
                        <div class="row-actions">
                          <button type="button" class="btn btn-secondary btn-sm" data-edit-product="${escapeHtml(p.id)}">تعديل</button>
                          <button type="button" class="btn btn-danger btn-sm" data-delete-product="${escapeHtml(p.id)}" data-prod-name="${escapeHtml(p.name)}">حذف</button>
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        `
            : `<div class="panel-body">لا توجد منتجات مطابقة. اضغط على "إضافة منتج جديد" للبدء.</div>`
        }
      </div>
    </div>
  `;

  document.getElementById('admin-prod-search')?.addEventListener('input', (e) => {
    adminState.productSearch = e.target.value;
    renderProductsView(container);
    const inp = document.getElementById('admin-prod-search');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  });

  document.getElementById('admin-prod-cat-filter')?.addEventListener('change', (e) => {
    adminState.productFilterCat = e.target.value;
    renderProductsView(container);
  });

  document.getElementById('admin-prod-pub-filter')?.addEventListener('change', (e) => {
    adminState.productFilterPub = e.target.value;
    renderProductsView(container);
  });

  document.getElementById('add-product-btn')?.addEventListener('click', () => openProductModal(null));

  container.querySelectorAll('[data-edit-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prod = adminState.products.find((p) => p.id === btn.getAttribute('data-edit-product'));
      if (prod) openProductModal(prod);
    });
  });

  container.querySelectorAll('[data-toggle-publish]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-toggle-publish');
      const nextPub = btn.getAttribute('data-next-pub') === 'true';
      try {
        await apiFetch(`/api/admin/products/${id}/publish`, {
          method: 'PATCH',
          body: JSON.stringify({ isPublished: nextPub }),
        });
        await loadAllAdminData();
        renderAdminShell();
        showToast(nextPub ? 'تم نشر المنتج في المتجر.' : 'تم إخفاء المنتج من المتجر.');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('[data-delete-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-product');
      const name = btn.getAttribute('data-prod-name');
      confirmAction('حذف المنتج', `هل تريد حذف المنتج "${name}" نهائياً؟`, async () => {
        try {
          await apiFetch(`/api/admin/products/${id}`, { method: 'DELETE' });
          await loadAllAdminData();
          renderAdminShell();
          showToast('تم حذف المنتج.');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  });
}

function openProductModal(existing) {
  const isEdit = Boolean(existing);
  const workingImages = [...(existing?.images || [])];
  const workingColors = [...(existing?.colors || [{ name: 'كحلي ليلي', hex: '#0A1628' }])];

  const renderModalBody = () => {
    openModal(
      isEdit ? `تعديل المنتج: ${existing.name}` : 'إضافة منتج جديد',
      `
        <form id="product-editor-form" class="form-stack">
          <div class="form-grid-2">
            <div class="form-field">
              <label for="pf-name">اسم المنتج *</label>
              <input id="pf-name" name="name" type="text" class="form-control" required value="${escapeHtml(existing?.name || '')}" />
            </div>
            <div class="form-field">
              <label for="pf-category">الفئة</label>
              <select id="pf-category" name="categoryId" class="form-control">
                <option value="">بدون فئة</option>
                ${adminState.categories
                  .map(
                    (c) =>
                      `<option value="${escapeHtml(c.id)}" ${existing?.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <div class="form-field">
            <label for="pf-desc">الوصف التفصيلي</label>
            <textarea id="pf-desc" name="description" class="form-control">${escapeHtml(existing?.description || '')}</textarea>
          </div>

          <div class="form-grid-2">
            <div class="form-field">
              <label for="pf-price">السعر الأساسي *</label>
              <input id="pf-price" name="price" type="number" min="0" step="1" class="form-control" required value="${existing?.price ?? 0}" />
            </div>
            <div class="form-field">
              <label for="pf-sale-price">سعر العرض / التخفيض (اختياري)</label>
              <input id="pf-sale-price" name="salePrice" type="number" min="0" step="1" class="form-control" value="${existing?.salePrice ?? ''}" placeholder="اتركه فارغاً إذا لا يوجد" />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-field">
              <label for="pf-stock">الكمية المتوفرة بالمخزون *</label>
              <input id="pf-stock" name="stock" type="number" min="0" step="1" class="form-control" required value="${existing?.stock ?? 10}" />
            </div>
            <div class="form-field">
              <label for="pf-sizes">المقاسات المتاحة (مفصولة بفاصلة)</label>
              <input id="pf-sizes" name="sizes" type="text" class="form-control" value="${escapeHtml((existing?.sizes || ['S', 'M', 'L', 'XL']).join(', '))}" />
            </div>
          </div>

          <div class="form-field">
            <label>الألوان المتاحة</label>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
              <input type="text" id="new-color-name" class="form-control" style="max-width:180px;" placeholder="اسم اللون (مثال: ذهبي)" />
              <input type="color" id="new-color-hex" value="#C6A55C" style="width:44px;height:40px;border:1px solid var(--border-strong);border-radius:6px;padding:2px;" />
              <button type="button" id="add-color-chip-btn" class="btn btn-secondary btn-sm">+ إضافة لون</button>
            </div>
            <div id="product-colors-list" style="display:flex;flex-wrap:wrap;gap:0.45rem;margin-top:0.45rem;"></div>
          </div>

          <div class="form-field">
            <label>صور المنتج</label>
            <div class="upload-box">
              <input type="file" id="pf-image-file" accept="image/png,image/jpeg,image/webp" multiple />
              <span style="font-size:0.8rem;color:var(--text-muted);">ارفع صوراً من جهازك ليتم حفظها بشكل دائم</span>
            </div>
            <div id="pf-images-preview" class="image-preview-list"></div>
          </div>

          <div class="form-field">
            <label>المجموعات المرتبطة</label>
            <div style="display:flex;flex-wrap:wrap;gap:0.85rem;">
              ${adminState.collections
                .map(
                  (col) => `
                <label class="check-label">
                  <input type="checkbox" name="collectionIds" value="${escapeHtml(col.id)}" ${existing?.collectionIds?.includes(col.id) ? 'checked' : ''} />
                  <span>${escapeHtml(col.name)}</span>
                </label>
              `
                )
                .join('')}
            </div>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:1rem;padding:0.75rem;background:var(--bg-subtle);border-radius:6px;">
            <label class="check-label"><input type="checkbox" name="isPublished" ${existing ? (existing.isPublished ? 'checked' : '') : 'checked'} /> منشور بالمتجر</label>
            <label class="check-label"><input type="checkbox" name="showPrice" ${existing ? (existing.showPrice ? 'checked' : '') : 'checked'} /> إظهار السعر</label>
            <label class="check-label"><input type="checkbox" name="isFeatured" ${existing?.isFeatured ? 'checked' : ''} /> منتج مميز</label>
            <label class="check-label"><input type="checkbox" name="isBestSeller" ${existing?.isBestSeller ? 'checked' : ''} /> الأكثر مبيعاً</label>
            <label class="check-label"><input type="checkbox" name="isNewArrival" ${existing ? (existing.isNewArrival ? 'checked' : '') : 'checked'} /> وصل حديثاً</label>
            <label class="check-label"><input type="checkbox" name="showOnHomepage" ${existing ? (existing.showOnHomepage ? 'checked' : '') : 'checked'} /> الظهور بالرئيسية</label>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:0.65rem;">
            <button type="button" class="btn btn-secondary" id="pf-cancel">إلغاء</button>
            <button type="submit" class="btn btn-primary" id="pf-save">${isEdit ? 'حفظ التعديلات' : 'إنشاء المنتج'}</button>
          </div>
        </form>
      `
    );

    const refreshColorsUi = () => {
      const box = document.getElementById('product-colors-list');
      if (!box) return;
      box.innerHTML = workingColors
        .map(
          (c, i) => `
          <span class="color-swatch-btn" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.25rem 0.55rem;border:1px solid var(--border-hairline);border-radius:6px;font-size:0.82rem;">
            <span style="width:12px;height:12px;border-radius:3px;background:${escapeHtml(c.hex)};display:inline-block;"></span>
            <span>${escapeHtml(c.name)}</span>
            <button type="button" data-del-color="${i}" style="border:0;background:transparent;font-weight:700;">✕</button>
          </span>
        `
        )
        .join('');
      box.querySelectorAll('[data-del-color]').forEach((btn) => {
        btn.addEventListener('click', () => {
          workingColors.splice(Number(btn.getAttribute('data-del-color')), 1);
          refreshColorsUi();
        });
      });
    };

    const refreshImagesUi = () => {
      const box = document.getElementById('pf-images-preview');
      if (!box) return;
      box.innerHTML = workingImages
        .map(
          (url, i) => `
          <div class="image-preview-item">
            <img src="${escapeHtml(url)}" alt="صورة المنتج" />
            <button type="button" class="image-preview-remove" data-del-img="${i}" aria-label="حذف الصورة">✕</button>
          </div>
        `
        )
        .join('');
      box.querySelectorAll('[data-del-img]').forEach((btn) => {
        btn.addEventListener('click', () => {
          workingImages.splice(Number(btn.getAttribute('data-del-img')), 1);
          refreshImagesUi();
        });
      });
    };

    refreshColorsUi();
    refreshImagesUi();

    document.getElementById('add-color-chip-btn')?.addEventListener('click', () => {
      const nameInp = document.getElementById('new-color-name');
      const hexInp = document.getElementById('new-color-hex');
      const name = nameInp?.value.trim();
      if (!name) return;
      workingColors.push({ name, hex: hexInp?.value || '#0A1628' });
      nameInp.value = '';
      refreshColorsUi();
    });

    document.getElementById('pf-image-file')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        try {
          const url = await uploadImageFile(file);
          workingImages.push(url);
          refreshImagesUi();
          showToast('تم رفع الصورة بنجاح.');
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });

    document.getElementById('pf-cancel')?.addEventListener('click', closeModal);

    document.getElementById('product-editor-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const sizes = String(fd.get('sizes') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const collectionIds = fd.getAll('collectionIds').map(String);
      const saleRaw = String(fd.get('salePrice') || '').trim();

      const payload = {
        name: String(fd.get('name') || '').trim(),
        categoryId: String(fd.get('categoryId') || '') || null,
        description: String(fd.get('description') || '').trim(),
        price: Number(fd.get('price') || 0),
        salePrice: saleRaw !== '' ? Number(saleRaw) : null,
        stock: Number(fd.get('stock') || 0),
        sizes: sizes.length ? sizes : ['M', 'L'],
        colors: workingColors.length ? workingColors : [{ name: 'كحلي ليلي', hex: '#0A1628' }],
        images: workingImages,
        collectionIds,
        isPublished: form.querySelector('[name="isPublished"]').checked,
        showPrice: form.querySelector('[name="showPrice"]').checked,
        isFeatured: form.querySelector('[name="isFeatured"]').checked,
        isBestSeller: form.querySelector('[name="isBestSeller"]').checked,
        isNewArrival: form.querySelector('[name="isNewArrival"]').checked,
        showOnHomepage: form.querySelector('[name="showOnHomepage"]').checked,
      };

      try {
        if (isEdit) {
          await apiFetch(`/api/admin/products/${existing.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          showToast('تم تحديث المنتج وحفظ التغييرات.');
        } else {
          await apiFetch('/api/admin/products', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          showToast('تمت إضافة المنتج الجديد بنجاح.');
        }
        closeModal();
        await loadAllAdminData();
        renderAdminShell();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  };

  renderModalBody();
}

// ==========================================
// 3. Categories Manager
// ==========================================

function renderCategoriesView(container) {
  const catMap = new Map(adminState.categories.map((c) => [c.id, c.name]));
  container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">الفئات والفئات الفرعية</h2>
        <button type="button" class="btn btn-primary btn-sm" id="add-cat-btn">+ إضافة فئة جديدة</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>الصورة</th>
              <th>الاسم</th>
              <th>الفئة الأب</th>
              <th>الترتيب</th>
              <th>الظهور</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${adminState.categories
              .map(
                (c) => `
              <tr>
                <td>
                  ${
                    c.image
                      ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" class="thumb-cell" />`
                      : `<div class="thumb-cell" style="display:grid;place-items:center;font-size:0.7rem;">فئة</div>`
                  }
                </td>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td>${escapeHtml(c.parentId ? catMap.get(c.parentId) || '—' : 'فئة رئيسية')}</td>
                <td class="tabular-nums">${c.sortOrder}</td>
                <td><span class="status-label ${c.isVisible ? 'status-ok' : 'status-muted'}">${c.isVisible ? 'ظاهرة' : 'مخفية'}</span></td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-edit-cat="${escapeHtml(c.id)}">تعديل</button>
                    <button type="button" class="btn btn-danger btn-sm" data-del-cat="${escapeHtml(c.id)}" data-cat-name="${escapeHtml(c.name)}">حذف</button>
                  </div>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('add-cat-btn')?.addEventListener('click', () => openCategoryModal(null));
  container.querySelectorAll('[data-edit-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = adminState.categories.find((c) => c.id === btn.getAttribute('data-edit-cat'));
      if (cat) openCategoryModal(cat);
    });
  });
  container.querySelectorAll('[data-del-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-cat');
      const name = btn.getAttribute('data-cat-name');
      confirmAction('حذف الفئة', `هل تريد حذف الفئة "${name}"؟`, async () => {
        await apiFetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
        await loadAllAdminData();
        renderAdminShell();
        showToast('تم حذف الفئة.');
      });
    });
  });
}

function openCategoryModal(existing) {
  const isEdit = Boolean(existing);
  let currentImage = existing?.image || '';

  openModal(
    isEdit ? `تعديل الفئة: ${existing.name}` : 'إنشاء فئة جديدة',
    `
      <form id="cat-editor-form" class="form-stack">
        <div class="form-field">
          <label for="cf-name">اسم الفئة *</label>
          <input id="cf-name" name="name" type="text" class="form-control" required value="${escapeHtml(existing?.name || '')}" />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label for="cf-parent">الفئة الأب (لإنشاء فئة فرعية)</label>
            <select id="cf-parent" name="parentId" class="form-control">
              <option value="">فئة رئيسية</option>
              ${adminState.categories
                .filter((c) => c.id !== existing?.id)
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${existing?.parentId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="cf-order">ترتيب العرض</label>
            <input id="cf-order" name="sortOrder" type="number" class="form-control" value="${existing?.sortOrder ?? 0}" />
          </div>
        </div>
        <div class="form-field">
          <label>صورة الفئة</label>
          <div class="upload-box">
            <input type="file" id="cf-img-file" accept="image/png,image/jpeg,image/webp" />
          </div>
          <div id="cf-img-preview" style="margin-top:0.5rem;">
            ${currentImage ? `<img src="${escapeHtml(currentImage)}" class="thumb-cell" style="width:72px;height:72px;" />` : ''}
          </div>
        </div>
        <label class="check-label">
          <input type="checkbox" name="isVisible" ${existing ? (existing.isVisible ? 'checked' : '') : 'checked'} />
          إظهار الفئة في المتجر
        </label>
        <div style="display:flex;justify-content:flex-end;gap:0.65rem;">
          <button type="button" class="btn btn-secondary" id="cf-cancel">إلغاء</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'حفظ الفئة' : 'إنشاء الفئة'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('cf-cancel')?.addEventListener('click', closeModal);
  document.getElementById('cf-img-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    currentImage = await uploadImageFile(file);
    const prev = document.getElementById('cf-img-preview');
    if (prev) prev.innerHTML = `<img src="${escapeHtml(currentImage)}" class="thumb-cell" style="width:72px;height:72px;" />`;
    showToast('تم رفع صورة الفئة.');
  });

  document.getElementById('cat-editor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get('name') || '').trim(),
      parentId: String(fd.get('parentId') || '') || null,
      sortOrder: Number(fd.get('sortOrder') || 0),
      image: currentImage,
      isVisible: form.querySelector('[name="isVisible"]').checked,
    };
    if (isEdit) {
      await apiFetch(`/api/admin/categories/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('تم تحديث الفئة.');
    } else {
      await apiFetch('/api/admin/categories', { method: 'POST', body: JSON.stringify(payload) });
      showToast('تمت إضافة الفئة.');
    }
    closeModal();
    await loadAllAdminData();
    renderAdminShell();
  });
}

// ==========================================
// 4. Collections Manager
// ==========================================

function renderCollectionsView(container) {
  container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">إدارة المجموعات والكبسولات</h2>
        <button type="button" class="btn btn-primary btn-sm" id="add-col-btn">+ إنشاء مجموعة</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>الغلاف</th>
              <th>اسم المجموعة</th>
              <th>القطع المرتبطة</th>
              <th>الترتيب</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${adminState.collections
              .map(
                (col) => `
              <tr>
                <td>${renderImageWithFallback(col.coverImage, col.name, 'thumb-cell')}</td>
                <td>
                  <strong>${escapeHtml(col.name)}</strong>
                  <div style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(col.description)}</div>
                </td>
                <td class="tabular-nums">${col.productIds.length}</td>
                <td class="tabular-nums">${col.sortOrder}</td>
                <td><span class="status-label ${col.isPublished ? 'status-ok' : 'status-muted'}">${col.isPublished ? 'منشورة' : 'مخفية'}</span></td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-edit-col="${escapeHtml(col.id)}">تعديل</button>
                    <button type="button" class="btn btn-danger btn-sm" data-del-col="${escapeHtml(col.id)}" data-col-name="${escapeHtml(col.name)}">حذف</button>
                  </div>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('add-col-btn')?.addEventListener('click', () => openCollectionModal(null));
  container.querySelectorAll('[data-edit-col]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const col = adminState.collections.find((c) => c.id === btn.getAttribute('data-edit-col'));
      if (col) openCollectionModal(col);
    });
  });
  container.querySelectorAll('[data-del-col]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-col');
      const name = btn.getAttribute('data-col-name');
      confirmAction('حذف المجموعة', `هل تريد حذف المجموعة "${name}"؟`, async () => {
        await apiFetch(`/api/admin/collections/${id}`, { method: 'DELETE' });
        await loadAllAdminData();
        renderAdminShell();
        showToast('تم حذف المجموعة.');
      });
    });
  });
}

function openCollectionModal(existing) {
  const isEdit = Boolean(existing);
  let coverImage = existing?.coverImage || '';

  openModal(
    isEdit ? `تعديل المجموعة: ${existing.name}` : 'إنشاء مجموعة جديدة',
    `
      <form id="col-editor-form" class="form-stack">
        <div class="form-grid-2">
          <div class="form-field">
            <label for="colf-name">اسم المجموعة *</label>
            <input id="colf-name" name="name" type="text" class="form-control" required value="${escapeHtml(existing?.name || '')}" />
          </div>
          <div class="form-field">
            <label for="colf-order">ترتيب العرض</label>
            <input id="colf-order" name="sortOrder" type="number" class="form-control" value="${existing?.sortOrder ?? 1}" />
          </div>
        </div>
        <div class="form-field">
          <label for="colf-desc">وصف المجموعة</label>
          <textarea id="colf-desc" name="description" class="form-control">${escapeHtml(existing?.description || '')}</textarea>
        </div>
        <div class="form-field">
          <label>صورة الغلاف</label>
          <div class="upload-box"><input type="file" id="colf-img-file" accept="image/png,image/jpeg,image/webp" /></div>
          <div id="colf-img-preview" style="margin-top:0.5rem;">
            ${coverImage ? `<img src="${escapeHtml(coverImage)}" class="thumb-cell" style="width:96px;height:72px;" />` : ''}
          </div>
        </div>
        <div class="form-field">
          <label>المنتجات ضمن هذه المجموعة</label>
          <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border-hairline);border-radius:6px;padding:0.75rem;display:grid;gap:0.45rem;">
            ${adminState.products
              .map(
                (p) => `
              <label class="check-label">
                <input type="checkbox" name="productIds" value="${escapeHtml(p.id)}" ${existing?.productIds?.includes(p.id) ? 'checked' : ''} />
                <span>${escapeHtml(p.name)}</span>
              </label>
            `
              )
              .join('')}
          </div>
        </div>
        <label class="check-label">
          <input type="checkbox" name="isPublished" ${existing ? (existing.isPublished ? 'checked' : '') : 'checked'} />
          نشر المجموعة في المتجر
        </label>
        <div style="display:flex;justify-content:flex-end;gap:0.65rem;">
          <button type="button" class="btn btn-secondary" id="colf-cancel">إلغاء</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'حفظ التغييرات' : 'إنشاء المجموعة'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('colf-cancel')?.addEventListener('click', closeModal);
  document.getElementById('colf-img-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    coverImage = await uploadImageFile(file);
    const prev = document.getElementById('colf-img-preview');
    if (prev) prev.innerHTML = `<img src="${escapeHtml(coverImage)}" class="thumb-cell" style="width:96px;height:72px;" />`;
    showToast('تم رفع غلاف المجموعة.');
  });

  document.getElementById('col-editor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get('name') || '').trim(),
      description: String(fd.get('description') || '').trim(),
      sortOrder: Number(fd.get('sortOrder') || 0),
      coverImage,
      productIds: fd.getAll('productIds').map(String),
      isPublished: form.querySelector('[name="isPublished"]').checked,
    };
    if (isEdit) {
      await apiFetch(`/api/admin/collections/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('تم تحديث المجموعة.');
    } else {
      await apiFetch('/api/admin/collections', { method: 'POST', body: JSON.stringify(payload) });
      showToast('تم إنشاء المجموعة.');
    }
    closeModal();
    await loadAllAdminData();
    renderAdminShell();
  });
}

// ==========================================
// 5. Offers Manager
// ==========================================

function renderOffersView(container) {
  container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">العروض الترويجية والخصومات</h2>
        <button type="button" class="btn btn-primary btn-sm" id="add-offer-btn">+ إنشاء عرض جديد</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>العرض</th>
              <th>نسبة الخصم</th>
              <th>النطاق</th>
              <th>الفترة</th>
              <th>الحالة الفعلية</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${adminState.offers
              .map(
                (o) => `
              <tr>
                <td>
                  <strong>${escapeHtml(o.title)}</strong>
                  <div style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(o.bannerText)}</div>
                </td>
                <td class="tabular-nums"><strong>${o.discountPercent}%</strong></td>
                <td>${o.targetType === 'all' ? 'كل المتجر' : o.targetType === 'products' ? `${o.targetIds.length} منتجات` : `${o.targetIds.length} مجموعات`}</td>
                <td style="font-size:0.8rem;">${escapeHtml(formatDateAr(o.startDate))} — ${escapeHtml(formatDateAr(o.endDate))}</td>
                <td>
                  <span class="status-label ${o.isCurrentlyActive ? 'status-ok' : 'status-muted'}">
                    ${o.isCurrentlyActive ? 'فعّال الآن' : o.isActive ? 'منتهي / مجدول' : 'معطّل'}
                  </span>
                </td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-edit-offer="${escapeHtml(o.id)}">تعديل</button>
                    <button type="button" class="btn btn-danger btn-sm" data-del-offer="${escapeHtml(o.id)}" data-offer-title="${escapeHtml(o.title)}">حذف</button>
                  </div>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('add-offer-btn')?.addEventListener('click', () => openOfferModal(null));
  container.querySelectorAll('[data-edit-offer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const offer = adminState.offers.find((o) => o.id === btn.getAttribute('data-edit-offer'));
      if (offer) openOfferModal(offer);
    });
  });
  container.querySelectorAll('[data-del-offer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-offer');
      const title = btn.getAttribute('data-offer-title');
      confirmAction('حذف العرض', `هل تريد حذف العرض "${title}"؟`, async () => {
        await apiFetch(`/api/admin/offers/${id}`, { method: 'DELETE' });
        await loadAllAdminData();
        renderAdminShell();
        showToast('تم حذف العرض.');
      });
    });
  });
}

function openOfferModal(existing) {
  const isEdit = Boolean(existing);
  const toDateInput = (iso) => (iso ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10));

  openModal(
    isEdit ? `تعديل العرض: ${existing.title}` : 'إنشاء عرض خصم جديد',
    `
      <form id="offer-editor-form" class="form-stack">
        <div class="form-grid-2">
          <div class="form-field">
            <label for="of-title">عنوان العرض *</label>
            <input id="of-title" name="title" type="text" class="form-control" required value="${escapeHtml(existing?.title || '')}" />
          </div>
          <div class="form-field">
            <label for="of-pct">نسبة الخصم (%) *</label>
            <input id="of-pct" name="discountPercent" type="number" min="1" max="95" class="form-control" required value="${existing?.discountPercent ?? 15}" />
          </div>
        </div>
        <div class="form-field">
          <label for="of-banner">نص الترويج</label>
          <input id="of-banner" name="bannerText" type="text" class="form-control" value="${escapeHtml(existing?.bannerText || '')}" />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label for="of-start">تاريخ البداية</label>
            <input id="of-start" name="startDate" type="date" class="form-control" required value="${toDateInput(existing?.startDate)}" />
          </div>
          <div class="form-field">
            <label for="of-end">تاريخ الانتهاء</label>
            <input id="of-end" name="endDate" type="date" class="form-control" required value="${toDateInput(existing?.endDate || new Date(Date.now() + 14 * 86400000).toISOString())}" />
          </div>
        </div>
        <div class="form-field">
          <label for="of-target-type">تطبيق العرض على</label>
          <select id="of-target-type" name="targetType" class="form-control">
            <option value="all" ${existing?.targetType === 'all' ? 'selected' : ''}>جميع المنتجات</option>
            <option value="collections" ${existing?.targetType === 'collections' ? 'selected' : ''}>مجموعات محددة</option>
            <option value="products" ${existing?.targetType === 'products' ? 'selected' : ''}>منتجات محددة</option>
          </select>
        </div>
        <div class="form-field" id="of-targets-box"></div>
        <label class="check-label">
          <input type="checkbox" name="isActive" ${existing ? (existing.isActive ? 'checked' : '') : 'checked'} />
          تفعيل العرض
        </label>
        <div style="display:flex;justify-content:flex-end;gap:0.65rem;">
          <button type="button" class="btn btn-secondary" id="of-cancel">إلغاء</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'حفظ العرض' : 'إنشاء العرض'}</button>
        </div>
      </form>
    `
  );

  const renderTargets = (type) => {
    const box = document.getElementById('of-targets-box');
    if (!box) return;
    if (type === 'all') {
      box.innerHTML = '';
      return;
    }
    const list = type === 'collections' ? adminState.collections : adminState.products;
    box.innerHTML = `
      <label>${type === 'collections' ? 'اختر المجموعات' : 'اختر المنتجات'}</label>
      <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border-hairline);border-radius:6px;padding:0.65rem;display:grid;gap:0.35rem;">
        ${list
          .map(
            (item) => `
          <label class="check-label">
            <input type="checkbox" name="targetIds" value="${escapeHtml(item.id)}" ${existing?.targetIds?.includes(item.id) ? 'checked' : ''} />
            <span>${escapeHtml(item.name)}</span>
          </label>
        `
          )
          .join('')}
      </div>
    `;
  };

  const typeSel = document.getElementById('of-target-type');
  renderTargets(typeSel?.value || 'all');
  typeSel?.addEventListener('change', (e) => renderTargets(e.target.value));
  document.getElementById('of-cancel')?.addEventListener('click', closeModal);

  document.getElementById('offer-editor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const payload = {
      title: String(fd.get('title') || '').trim(),
      bannerText: String(fd.get('bannerText') || '').trim(),
      discountPercent: Number(fd.get('discountPercent') || 10),
      startDate: `${fd.get('startDate')}T00:00:00.000Z`,
      endDate: `${fd.get('endDate')}T23:59:59.000Z`,
      targetType: String(fd.get('targetType') || 'all'),
      targetIds: fd.getAll('targetIds').map(String),
      isActive: form.querySelector('[name="isActive"]').checked,
    };
    if (isEdit) {
      await apiFetch(`/api/admin/offers/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('تم تحديث العرض.');
    } else {
      await apiFetch('/api/admin/offers', { method: 'POST', body: JSON.stringify(payload) });
      showToast('تم إنشاء العرض بنجاح.');
    }
    closeModal();
    await loadAllAdminData();
    renderAdminShell();
  });
}

// ==========================================
// 6. Homepage Editor
// ==========================================

function renderHomepageEditorView(container) {
  const hp = structuredClone(adminState.homepage);

  const render = () => {
    container.innerHTML = `
      <form id="homepage-editor-form" class="form-stack">
        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">القسم الرئيسي (Hero Banner)</h2>
            <button type="submit" class="btn btn-primary btn-sm">حفظ الصفحة الرئيسية</button>
          </div>
          <div class="panel-body form-stack">
            <div class="form-grid-2">
              <div class="form-field">
                <label for="hp-kicker">النص التعريفي العلوي</label>
                <input id="hp-kicker" class="form-control" value="${escapeHtml(hp.heroKicker)}" />
              </div>
              <div class="form-field">
                <label for="hp-title">العنوان الرئيسي (Hero Title)</label>
                <input id="hp-title" class="form-control" required value="${escapeHtml(hp.heroTitle)}" />
              </div>
            </div>

            <div class="form-field">
              <label for="hp-desc">الوصف الرئيسي</label>
              <textarea id="hp-desc" class="form-control">${escapeHtml(hp.heroDescription)}</textarea>
            </div>

            <div class="form-grid-2">
              <div class="form-field">
                <label for="hp-cta1-label">نص الزر الأساسي</label>
                <input id="hp-cta1-label" class="form-control" value="${escapeHtml(hp.heroPrimaryCtaLabel)}" />
              </div>
              <div class="form-field">
                <label for="hp-cta1-link">رابط الزر الأساسي</label>
                <input id="hp-cta1-link" class="form-control" value="${escapeHtml(hp.heroPrimaryCtaLink)}" />
              </div>
              <div class="form-field">
                <label for="hp-cta2-label">نص الزر الثانوي</label>
                <input id="hp-cta2-label" class="form-control" value="${escapeHtml(hp.heroSecondaryCtaLabel)}" />
              </div>
              <div class="form-field">
                <label for="hp-cta2-link">رابط الزر الثانوي</label>
                <input id="hp-cta2-link" class="form-control" value="${escapeHtml(hp.heroSecondaryCtaLink)}" />
              </div>
            </div>

            <div class="form-field">
              <label>صورة الهيرو الرئيسية</label>
              <div class="upload-box">
                <input type="file" id="hp-hero-file" accept="image/png,image/jpeg,image/webp" />
                ${hp.heroImage ? `<img src="${escapeHtml(hp.heroImage)}" class="thumb-cell" style="width:96px;height:56px;" />` : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">ترتيب وإظهار أقسام الصفحة الرئيسية</h2>
          </div>
          <div class="panel-body form-stack">
            ${hp.sections
              .sort((a, b) => a.order - b.order)
              .map(
                (sec, idx) => `
              <div class="section-order-item">
                <label class="check-label">
                  <input type="checkbox" data-sec-vis="${idx}" ${sec.isVisible ? 'checked' : ''} />
                  <strong>${escapeHtml(sec.label)}</strong>
                </label>
                <div class="row-actions">
                  <button type="button" class="btn btn-secondary btn-sm" data-sec-up="${idx}" ${idx === 0 ? 'disabled' : ''}>▲ للأعلى</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-sec-down="${idx}" ${idx === hp.sections.length - 1 ? 'disabled' : ''}>▼ للأسفل</button>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">البنرات الترويجية</h2>
            <button type="button" class="btn btn-secondary btn-sm" id="hp-add-banner">+ إضافة بنر</button>
          </div>
          <div class="panel-body form-stack">
            ${hp.promoBanners
              .map(
                (b, idx) => `
              <div style="padding:1rem;border:1px solid var(--border-hairline);border-radius:8px;display:grid;gap:0.75rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <label class="check-label"><input type="checkbox" data-b-vis="${idx}" ${b.isVisible ? 'checked' : ''} /> إظهار البنر</label>
                  <button type="button" class="btn btn-danger btn-sm" data-b-del="${idx}">حذف</button>
                </div>
                <div class="form-grid-2">
                  <input class="form-control" data-b-title="${idx}" value="${escapeHtml(b.title)}" placeholder="عنوان البنر" />
                  <input class="form-control" data-b-cta="${idx}" value="${escapeHtml(b.ctaLabel)}" placeholder="نص الزر" />
                </div>
                <input class="form-control" data-b-sub="${idx}" value="${escapeHtml(b.subtitle)}" placeholder="وصف البنر" />
                <div class="upload-box">
                  <input type="file" data-b-file="${idx}" accept="image/png,image/jpeg,image/webp" />
                  ${b.image ? `<img src="${escapeHtml(b.image)}" class="thumb-cell" />` : ''}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">المنتجات والمجموعات المختارة للرئيسية</h2>
          </div>
          <div class="panel-body form-grid-2">
            <div>
              <h3 style="margin:0 0 0.65rem;font-size:0.92rem;">المنتجات المميزة</h3>
              <div style="display:grid;gap:0.4rem;">
                ${adminState.products
                  .map(
                    (p) => `
                  <label class="check-label">
                    <input type="checkbox" data-hp-prod="${escapeHtml(p.id)}" ${hp.featuredProductIds.includes(p.id) ? 'checked' : ''} />
                    <span>${escapeHtml(p.name)}</span>
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>
            <div>
              <h3 style="margin:0 0 0.65rem;font-size:0.92rem;">المجموعات المميزة</h3>
              <div style="display:grid;gap:0.4rem;">
                ${adminState.collections
                  .map(
                    (col) => `
                  <label class="check-label">
                    <input type="checkbox" data-hp-col="${escapeHtml(col.id)}" ${hp.featuredCollectionIds.includes(col.id) ? 'checked' : ''} />
                    <span>${escapeHtml(col.name)}</span>
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>
      </form>
    `;

    const syncInputsIntoModel = () => {
      hp.heroKicker = document.getElementById('hp-kicker')?.value || '';
      hp.heroTitle = document.getElementById('hp-title')?.value || '';
      hp.heroDescription = document.getElementById('hp-desc')?.value || '';
      hp.heroPrimaryCtaLabel = document.getElementById('hp-cta1-label')?.value || '';
      hp.heroPrimaryCtaLink = document.getElementById('hp-cta1-link')?.value || '#catalog';
      hp.heroSecondaryCtaLabel = document.getElementById('hp-cta2-label')?.value || '';
      hp.heroSecondaryCtaLink = document.getElementById('hp-cta2-link')?.value || '#collections';

      container.querySelectorAll('[data-sec-vis]').forEach((cb) => {
        const idx = Number(cb.getAttribute('data-sec-vis'));
        if (hp.sections[idx]) hp.sections[idx].isVisible = cb.checked;
      });
      hp.promoBanners.forEach((b, idx) => {
        b.isVisible = container.querySelector(`[data-b-vis="${idx}"]`)?.checked ?? b.isVisible;
        b.title = container.querySelector(`[data-b-title="${idx}"]`)?.value ?? b.title;
        b.subtitle = container.querySelector(`[data-b-sub="${idx}"]`)?.value ?? b.subtitle;
        b.ctaLabel = container.querySelector(`[data-b-cta="${idx}"]`)?.value ?? b.ctaLabel;
      });
      hp.featuredProductIds = Array.from(container.querySelectorAll('[data-hp-prod]:checked')).map((el) =>
        el.getAttribute('data-hp-prod')
      );
      hp.featuredCollectionIds = Array.from(container.querySelectorAll('[data-hp-col]:checked')).map((el) =>
        el.getAttribute('data-hp-col')
      );
    };

    document.getElementById('hp-hero-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      syncInputsIntoModel();
      hp.heroImage = await uploadImageFile(file);
      showToast('تم رفع صورة الهيرو.');
      render();
    });

    container.querySelectorAll('[data-b-file]').forEach((inp) => {
      inp.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        syncInputsIntoModel();
        const idx = Number(inp.getAttribute('data-b-file'));
        hp.promoBanners[idx].image = await uploadImageFile(file);
        showToast('تم رفع صورة البنر.');
        render();
      });
    });

    container.querySelectorAll('[data-sec-up]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncInputsIntoModel();
        const idx = Number(btn.getAttribute('data-sec-up'));
        if (idx <= 0) return;
        const arr = hp.sections;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        arr.forEach((s, i) => (s.order = i + 1));
        render();
      });
    });

    container.querySelectorAll('[data-sec-down]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncInputsIntoModel();
        const idx = Number(btn.getAttribute('data-sec-down'));
        const arr = hp.sections;
        if (idx >= arr.length - 1) return;
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        arr.forEach((s, i) => (s.order = i + 1));
        render();
      });
    });

    document.getElementById('hp-add-banner')?.addEventListener('click', () => {
      syncInputsIntoModel();
      hp.promoBanners.push({
        id: `banner-${Date.now()}`,
        title: 'عرض خاص من دار ORVA 7',
        subtitle: 'تشكيلة مختارة لفترة محدودة.',
        ctaLabel: 'تسوق الآن',
        ctaLink: '#catalog',
        image: '',
        isVisible: true,
      });
      render();
    });

    container.querySelectorAll('[data-b-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncInputsIntoModel();
        hp.promoBanners.splice(Number(btn.getAttribute('data-b-del')), 1);
        render();
      });
    });

    document.getElementById('homepage-editor-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      syncInputsIntoModel();
      await apiFetch('/api/admin/homepage', { method: 'PUT', body: JSON.stringify(hp) });
      await loadAllAdminData();
      showToast('تم حفظ تعديلات الصفحة الرئيسية بنجاح.');
    });
  };

  render();
}

// ==========================================
// 7. Orders Manager
// ==========================================

function renderOrdersView(container) {
  const currency = adminState.settings?.currencySymbol || 'ج.م';
  const filtered = adminState.orders.filter((o) =>
    adminState.orderFilterStatus === 'all' ? true : o.status === adminState.orderFilterStatus
  );

  container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">سجل الطلبات (${filtered.length})</h2>
        <select id="admin-order-status-filter" class="form-control" style="max-width:200px;">
          <option value="all" ${adminState.orderFilterStatus === 'all' ? 'selected' : ''}>جميع الحالات</option>
          ${Object.entries(ORDER_STATUS_META)
            .map(
              ([k, v]) =>
                `<option value="${k}" ${adminState.orderFilterStatus === k ? 'selected' : ''}>${v.label}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="table-scroll">
        ${
          filtered.length
            ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>العميل</th>
                <th>الهاتف</th>
                <th>القطع</th>
                <th>الإجمالي</th>
                <th>الدفع</th>
                <th>حالة الطلب</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((ord) => {
                  const methodLabel = PAYMENT_METHOD_LABELS[ord.paymentMethod] || ord.paymentMethod || 'واتساب';
                  return `
                <tr>
                  <td class="tabular-nums"><strong>${escapeHtml(ord.orderNumber)}</strong><div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(formatDateAr(ord.createdAt))}</div></td>
                  <td>${escapeHtml(ord.customerName)}</td>
                  <td class="tabular-nums">${escapeHtml(ord.customerPhone)}</td>
                  <td class="tabular-nums">${ord.items.reduce((s, i) => s + i.quantity, 0)}</td>
                  <td class="tabular-nums"><strong>${escapeHtml(formatPrice(ord.totalPrice, currency))}</strong></td>
                  <td>
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem;">${escapeHtml(methodLabel)}</div>
                    <select class="form-control" style="min-height:32px;font-size:0.8rem;" data-order-payment-status="${escapeHtml(ord.id)}">
                      ${Object.entries(PAYMENT_STATUS_META)
                        .map(
                          ([k, v]) =>
                            `<option value="${k}" ${ord.paymentStatus === k ? 'selected' : ''}>${v.label}</option>`
                        )
                        .join('')}
                    </select>
                  </td>
                  <td>
                    <select class="form-control" style="min-height:34px;font-size:0.82rem;" data-order-status="${escapeHtml(ord.id)}">
                      ${Object.entries(ORDER_STATUS_META)
                        .map(
                          ([k, v]) =>
                            `<option value="${k}" ${ord.status === k ? 'selected' : ''}>${v.label}</option>`
                        )
                        .join('')}
                    </select>
                  </td>
                  <td>
                    <button type="button" class="btn btn-secondary btn-sm" data-view-order="${escapeHtml(ord.id)}">التفاصيل</button>
                  </td>
                </tr>
              `;
                })
                .join('')}
            </tbody>
          </table>
        `
            : `<div class="panel-body">لا توجد طلبات ضمن هذه الحالة.</div>`
        }
      </div>
    </div>
  `;

  document.getElementById('admin-order-status-filter')?.addEventListener('change', (e) => {
    adminState.orderFilterStatus = e.target.value;
    renderOrdersView(container);
  });

  container.querySelectorAll('[data-order-status]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.getAttribute('data-order-status');
      const status = sel.value;
      await apiFetch(`/api/admin/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadAllAdminData();
      showToast('تم تحديث حالة الطلب.');
    });
  });

  container.querySelectorAll('[data-order-payment-status]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.getAttribute('data-order-payment-status');
      const paymentStatus = sel.value;
      await apiFetch(`/api/admin/orders/${id}/payment`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus }),
      });
      await loadAllAdminData();
      showToast('تم تحديث حالة الدفع بنجاح.');
    });
  });

  container.querySelectorAll('[data-view-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ord = adminState.orders.find((o) => o.id === btn.getAttribute('data-view-order'));
      if (!ord) return;
      const pmMeta = PAYMENT_STATUS_META[ord.paymentStatus] || { label: ord.paymentStatus || 'غير مدفوع', cls: 'status-muted' };
      const methodLabel = PAYMENT_METHOD_LABELS[ord.paymentMethod] || ord.paymentMethod || 'واتساب';
      openModal(
        `تفاصيل الطلب ${ord.orderNumber}`,
        `
          <div class="form-stack">
            <div style="display:grid;gap:0.35rem;padding:0.85rem;background:var(--bg-subtle);border-radius:6px;">
              <div><strong>العميل:</strong> ${escapeHtml(ord.customerName)}</div>
              <div><strong>الهاتف:</strong> ${escapeHtml(ord.customerPhone)}</div>
              <div><strong>العنوان:</strong> ${escapeHtml(ord.customerAddress || 'غير محدد')}</div>
              <div><strong>ملاحظات:</strong> ${escapeHtml(ord.customerNotes || 'لا توجد')}</div>
              <div><strong>وسيلة الدفع:</strong> ${escapeHtml(methodLabel)} · <span class="status-label ${pmMeta.cls}">${pmMeta.label}</span></div>
              ${ord.paymentReference ? `<div><strong>مرجع العملية:</strong> <span class="tabular-nums">${escapeHtml(ord.paymentReference)}</span></div>` : ''}
            </div>
            <table class="data-table">
              <thead>
                <tr><th>المنتج</th><th>المقاس</th><th>اللون</th><th>الكمية</th><th>الإجمالي</th></tr>
              </thead>
              <tbody>
                ${ord.items
                  .map(
                    (i) => `
                  <tr>
                    <td>${escapeHtml(i.productName)}</td>
                    <td>${escapeHtml(i.size)}</td>
                    <td>${escapeHtml(i.color)}</td>
                    <td class="tabular-nums">${i.quantity}</td>
                    <td class="tabular-nums">${escapeHtml(formatPrice(i.lineTotal, currency))}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
            <div style="text-align:left;font-size:1.05rem;"><strong>الإجمالي النهائي: ${escapeHtml(formatPrice(ord.totalPrice, currency))}</strong></div>
          </div>
        `
      );
    });
  });
}

// ==========================================
// 8. Store Settings & Security
// ==========================================

function renderSettingsView(container) {
  const s = structuredClone(adminState.settings);

  container.innerHTML = `
    <form id="store-settings-form" class="form-stack">
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">بيانات المتجر والهوية</h2>
          <button type="submit" class="btn btn-primary btn-sm">حفظ الإعدادات</button>
        </div>
        <div class="panel-body form-stack">
          <div class="form-grid-2">
            <div class="form-field">
              <label for="st-name">اسم المتجر</label>
              <input id="st-name" class="form-control" required value="${escapeHtml(s.storeName)}" />
            </div>
            <div class="form-field">
              <label for="st-whatsapp">رقم واتساب الطلبات</label>
              <input id="st-whatsapp" class="form-control" required value="${escapeHtml(s.whatsappNumber)}" />
            </div>
            <div class="form-field">
              <label for="st-currency">رمز العملة (مثال: EGP / SAR)</label>
              <input id="st-currency" class="form-control" value="${escapeHtml(s.currency)}" />
            </div>
            <div class="form-field">
              <label for="st-symbol">اختصار العملة المعروض (مثال: ج.م / ر.س)</label>
              <input id="st-symbol" class="form-control" value="${escapeHtml(s.currencySymbol)}" />
            </div>
          </div>

          <div class="form-field">
            <label for="st-desc">وصف المتجر</label>
            <textarea id="st-desc" class="form-control">${escapeHtml(s.storeDescription)}</textarea>
          </div>

          <div class="form-grid-2">
            <div class="form-field">
              <label for="st-ann">شريط الإعلانات العلوي</label>
              <input id="st-ann" class="form-control" value="${escapeHtml(s.announcementText)}" />
            </div>
            <div class="form-field" style="justify-content:flex-end;">
              <label class="check-label"><input type="checkbox" id="st-ann-vis" ${s.announcementVisible ? 'checked' : ''} /> تفعيل شريط الإعلانات</label>
            </div>
          </div>

          <div class="form-field">
            <label>شعار مخصص (اختياري — اتركه فارغاً لاستخدام شعار ORVA 7 الافتراضي)</label>
            <div class="upload-box">
              <input type="file" id="st-logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
              ${s.logoUrl ? `<img src="${escapeHtml(s.logoUrl)}" class="thumb-cell" /> <button type="button" id="st-clear-logo" class="btn btn-secondary btn-sm">استعادة الشعار الافتراضي</button>` : ''}
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-field">
              <label for="st-email">البريد الإلكتروني</label>
              <input id="st-email" class="form-control" value="${escapeHtml(s.contactEmail)}" />
            </div>
            <div class="form-field">
              <label for="st-footer">نص حقوق التذييل (Footer)</label>
              <input id="st-footer" class="form-control" value="${escapeHtml(s.footerText)}" />
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-field">
              <label for="st-delivery">معلومات التوصيل</label>
              <textarea id="st-delivery" class="form-control">${escapeHtml(s.deliveryInfo)}</textarea>
            </div>
            <div class="form-field">
              <label for="st-return">سياسة الاستبدال والاسترجاع</label>
              <textarea id="st-return" class="form-control">${escapeHtml(s.returnPolicy)}</textarea>
            </div>
          </div>
        </div>
      </div>
    </form>

    <form id="admin-password-form" class="panel" style="margin-top:0;">
      <div class="panel-header">
        <h2 class="panel-title">تحديث كلمة مرور لوحة الإدارة</h2>
      </div>
      <div class="panel-body form-grid-2">
        <div class="form-field">
          <label for="pw-cur">كلمة المرور الحالية</label>
          <input id="pw-cur" type="password" class="form-control" required />
        </div>
        <div class="form-field">
          <label for="pw-new">كلمة المرور الجديدة (8 أحرف فأكثر)</label>
          <input id="pw-new" type="password" class="form-control" minlength="8" required />
        </div>
        <div>
          <button type="submit" class="btn btn-secondary btn-sm">تحديث كلمة المرور</button>
        </div>
      </div>
    </form>
  `;

  document.getElementById('st-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    s.logoUrl = await uploadImageFile(file);
    adminState.settings.logoUrl = s.logoUrl;
    showToast('تم رفع الشعار.');
    renderSettingsView(container);
  });

  document.getElementById('st-clear-logo')?.addEventListener('click', () => {
    s.logoUrl = '';
    adminState.settings.logoUrl = '';
    renderSettingsView(container);
  });

  document.getElementById('store-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      ...s,
      storeName: document.getElementById('st-name').value.trim(),
      whatsappNumber: document.getElementById('st-whatsapp').value.trim(),
      currency: document.getElementById('st-currency').value.trim(),
      currencySymbol: document.getElementById('st-symbol').value.trim(),
      storeDescription: document.getElementById('st-desc').value.trim(),
      announcementText: document.getElementById('st-ann').value.trim(),
      announcementVisible: document.getElementById('st-ann-vis').checked,
      contactEmail: document.getElementById('st-email').value.trim(),
      footerText: document.getElementById('st-footer').value.trim(),
      deliveryInfo: document.getElementById('st-delivery').value.trim(),
      returnPolicy: document.getElementById('st-return').value.trim(),
    };
    await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
    await loadAllAdminData();
    showToast('تم حفظ إعدادات المتجر.');
  });

  document.getElementById('admin-password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('pw-cur').value;
    const newPassword = document.getElementById('pw-new').value;
    try {
      await apiFetch('/api/admin/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      e.target.reset();
      showToast('تم تحديث كلمة المرور بنجاح.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ==========================================
// Bootstrap Admin
// ==========================================

async function initAdmin() {
  document.getElementById('admin-modal-close')?.addEventListener('click', closeModal);

  try {
    const me = await apiFetch('/api/admin/me');
    if (me.authenticated) {
      adminState.authenticated = true;
      adminState.username = me.username;
      await loadAllAdminData();
      renderAdminShell();
    } else {
      clearAdminToken();
      adminState.authenticated = false;
      renderLoginScreen();
    }
  } catch {
    clearAdminToken();
    adminState.authenticated = false;
    renderLoginScreen();
  }
}

initAdmin();
