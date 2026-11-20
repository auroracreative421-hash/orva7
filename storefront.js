import {
  apiFetch,
  clearCustomerToken,
  escapeHtml,
  formatDateAr,
  formatPrice,
  getOrvaLogoSvg,
  ORDER_STATUS_META,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_META,
  renderImageWithFallback,
  renderStarsHtml,
  setCustomerToken,
  showToast,
} from './api.js';
import {
  auth as firebaseAuth,
  readSyncedCloudProfile,
  signInWithGooglePopup,
  signOutFirebase,
  syncWishlistToFirestore,
  upsertSyncedCloudProfile,
} from './firebaseClient.js';

const CART_STORAGE_KEY = 'orva7_shopping_cart_v1';

const state = {
  storefront: null,
  filteredProducts: [],
  customer: null,
  wishlistIds: [],
  accountTab: 'profile',
  accountOrders: [],
  accountMenuOpen: false,
  googleSyncBusy: false,
  filters: {
    search: '',
    categoryId: '',
    collectionId: '',
    size: '',
    color: '',
    minPrice: '',
    maxPrice: '',
    onSaleOnly: false,
    newArrivalOnly: false,
    bestSellerOnly: false,
    sort: 'featured',
  },
  activeTab: 'all',
  cart: loadCartFromStorage(),
  checkoutPaymentMethod: 'online_card',
  lastOrderReceipt: null,
  pdpState: {
    product: null,
    reviews: [],
    canReview: false,
    reviewRating: 5,
    selectedImageIdx: 0,
    selectedSize: '',
    selectedColor: '',
    quantity: 1,
    isZoomed: false,
  },
  aiChat: {
    isOpen: false,
    isSending: false,
    messages: [],
    history: [],
  },
};

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
  } catch {
    // ignore storage quota
  }
}

function updateCartBadge() {
  const countEl = document.getElementById('header-cart-count');
  const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  if (countEl) countEl.textContent = String(totalCount);
}

function findProductById(id) {
  return state.storefront?.products?.find((p) => p.id === id) || null;
}

function getCategoryName(categoryId) {
  if (!categoryId || !state.storefront?.categories) return 'أزياء ORVA 7';
  return state.storefront.categories.find((c) => c.id === categoryId)?.name || 'أزياء ORVA 7';
}

function renderHeaderAndFooter() {
  const { settings, categories, collections } = state.storefront;
  const currency = settings.currencySymbol || 'ج.م';

  const annBar = document.getElementById('announcement-bar');
  const annText = document.getElementById('announcement-text');
  if (annBar && annText) {
    if (settings.announcementVisible && settings.announcementText) {
      annText.textContent = settings.announcementText;
      annBar.hidden = false;
    } else {
      annBar.hidden = true;
    }
  }

  const brandNameEl = document.getElementById('brand-name-text');
  const brandLogoSlot = document.getElementById('brand-logo-slot');
  if (brandNameEl) brandNameEl.textContent = settings.storeName || 'ORVA 7';
  if (brandLogoSlot) {
    brandLogoSlot.innerHTML = settings.logoUrl
      ? `<img src="${escapeHtml(settings.logoUrl)}" alt="${escapeHtml(settings.storeName)}" class="brand-custom-logo" />`
      : getOrvaLogoSvg(32, false);
  }
  document.title = `${settings.storeName || 'ORVA 7'} | دار الأزياء الفاخرة`;

  const footerGrid = document.getElementById('footer-content');
  const footerCopyright = document.getElementById('footer-copyright');

  if (footerGrid) {
    const visibleCats = categories.slice(0, 5);
    const visibleCols = collections.slice(0, 4);
    footerGrid.innerHTML = `
      <div>
        <div class="brand-link" style="margin-bottom:0.75rem;">
          ${getOrvaLogoSvg(32, true)}
          <span class="brand-wordmark" style="color:#ffffff;">${escapeHtml(settings.storeName || 'ORVA 7')}</span>
        </div>
        <p style="margin:0 0 0.85rem;font-size:0.88rem;color:var(--silver-300);max-width:36ch;">
          ${escapeHtml(settings.storeDescription)}
        </p>
        <div style="font-size:0.82rem;color:var(--silver-400);">
          <span>العملة المعتمدة: ${escapeHtml(currency)}</span>
          <span aria-hidden="true"> · </span>
          <span>واتساب: ${escapeHtml(settings.whatsappNumber)}</span>
        </div>
      </div>

      <div>
        <h3 class="footer-heading">الفئات</h3>
        <ul class="footer-list">
          ${visibleCats
            .map(
              (c) =>
                `<li><a href="#catalog" data-footer-cat="${escapeHtml(c.id)}">${escapeHtml(c.name)}</a></li>`
            )
            .join('')}
        </ul>
      </div>

      <div>
        <h3 class="footer-heading">المجموعات</h3>
        <ul class="footer-list">
          ${visibleCols
            .map(
              (col) =>
                `<li><a href="#catalog" data-footer-col="${escapeHtml(col.id)}">${escapeHtml(col.name)}</a></li>`
            )
            .join('')}
        </ul>
      </div>

      <div>
        <h3 class="footer-heading">خدمة العملاء والسياسات</h3>
        <ul class="footer-list">
          <li>${escapeHtml(settings.deliveryInfo)}</li>
          <li>${escapeHtml(settings.returnPolicy)}</li>
          <li>البريد: ${escapeHtml(settings.contactEmail || 'atelier@orva7.com')}</li>
          <li>
            <a href="https://wa.me/${escapeHtml((settings.whatsappNumber || '').replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">
              تواصل مباشر عبر واتساب
            </a>
          </li>
        </ul>
      </div>
    `;

    footerGrid.querySelectorAll('[data-footer-cat]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        state.filters.categoryId = el.getAttribute('data-footer-cat') || '';
        state.filters.collectionId = '';
        applyCatalogFiltersAndRender(true);
      });
    });

    footerGrid.querySelectorAll('[data-footer-col]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        state.filters.collectionId = el.getAttribute('data-footer-col') || '';
        state.filters.categoryId = '';
        applyCatalogFiltersAndRender(true);
      });
    });
  }

  if (footerCopyright) {
    footerCopyright.textContent =
      settings.footerText || 'جميع الحقوق محفوظة © 2026 دار ORVA 7 للأزياء الفاخرة';
  }
}

function isWishlisted(productId) {
  return state.wishlistIds.includes(productId);
}

function updateAccountHeaderButton() {
  const label = document.getElementById('header-account-label');
  if (label) {
    if (state.customer) {
      const firstName = state.customer.name.trim().split(/\s+/)[0] || 'حسابي';
      const wishCount = state.wishlistIds.length;
      label.textContent = wishCount > 0 ? `${firstName} (${wishCount})` : firstName;
    } else {
      label.textContent = 'تسجيل الدخول';
    }
  }
  renderAccountDropdownMenu();
}

async function toggleWishlistItem(productId) {
  if (!state.customer) {
    showToast('يرجى تسجيل الدخول لحفظ القطع في قائمة المفضلة.');
    state.accountTab = 'login';
    openAccountModal();
    return;
  }

  const saved = isWishlisted(productId);
  try {
    const res = await apiFetch(`/api/wishlist/${encodeURIComponent(productId)}`, {
      method: saved ? 'DELETE' : 'POST',
    });
    state.wishlistIds = res.wishlistIds || [];
    updateAccountHeaderButton();
    document.querySelectorAll(`[data-toggle-wishlist="${CSS.escape(productId)}"]`).forEach((btn) => {
      const nowSaved = isWishlisted(productId);
      btn.classList.toggle('is-saved', nowSaved);
      btn.setAttribute('aria-pressed', String(nowSaved));
      btn.textContent = nowSaved ? '♥' : '♡';
    });
    if (firebaseAuth.currentUser && state.customer?.googleUid) {
      syncWishlistToFirestore(firebaseAuth.currentUser.uid, state.wishlistIds).catch(() => {});
    }
    showToast(saved ? 'تمت إزالة القطعة من المفضلة.' : 'تمت إضافة القطعة إلى المفضلة.');
  } catch (err) {
    showToast(err.message || 'تعذر تحديث المفضلة.', 'error');
  }
}

function renderProductCard(product, currencySymbol) {
  const catName = getCategoryName(product.categoryId);
  const pricing = product.pricing || {
    basePrice: product.price,
    finalPrice: product.price,
    hasDiscount: false,
    discountPercent: 0,
  };
  const revSum = product.reviewSummary || { averageRating: 0, reviewCount: 0 };
  const mainImg = product.images[0] || '';
  const cornerTag = pricing.hasDiscount
    ? `خصم ${pricing.discountPercent}%`
    : product.isNewArrival
      ? 'إصدار جديد'
      : product.isBestSeller
        ? 'الأكثر مبيعاً'
        : '';

  const stockLabel = product.stock > 0 ? 'متوفر' : 'نفذت الكمية';
  const saved = isWishlisted(product.id);

  return `
    <article class="product-card" data-product-id="${escapeHtml(product.id)}">
      <div class="product-media-wrap">
        <button
          type="button"
          class="product-media-btn"
          data-open-product="${escapeHtml(product.id)}"
          aria-label="عرض تفاصيل ${escapeHtml(product.name)}"
        >
          ${renderImageWithFallback(mainImg, product.name)}
          ${cornerTag ? `<span class="product-corner-tag">${escapeHtml(cornerTag)}</span>` : ''}
        </button>
        <button
          type="button"
          class="wishlist-heart-btn ${saved ? 'is-saved' : ''}"
          data-toggle-wishlist="${escapeHtml(product.id)}"
          aria-label="${saved ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}"
          aria-pressed="${saved}"
          title="${saved ? 'محفوظ في المفضلة' : 'حفظ في المفضلة'}"
        >
          ${saved ? '♥' : '♡'}
        </button>
      </div>

      <div class="product-body">
        <div class="product-meta-line">
          <span>${escapeHtml(catName)}</span>
          <span aria-hidden="true"> · </span>
          <span>${escapeHtml(stockLabel)}</span>
        </div>

        <button
          type="button"
          class="product-title-btn"
          data-open-product="${escapeHtml(product.id)}"
        >
          ${escapeHtml(product.name)}
        </button>

        ${
          revSum.reviewCount > 0
            ? `<div>${renderStarsHtml(revSum.averageRating, revSum.reviewCount)}</div>`
            : ''
        }

        <div class="product-price-row">
          ${
            product.showPrice
              ? `<span class="price-final">${escapeHtml(formatPrice(pricing.finalPrice, currencySymbol))}</span>
                 ${
                   pricing.hasDiscount
                     ? `<span class="price-old">${escapeHtml(formatPrice(pricing.basePrice, currencySymbol))}</span>`
                     : ''
                 }`
              : `<span class="price-final">السعر عند الطلب</span>`
          }
        </div>

        <div class="product-card-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-quick-add="${escapeHtml(product.id)}"
            ${product.stock <= 0 ? 'disabled' : ''}
          >
            ${product.stock > 0 ? 'أضف للحقيبة' : 'غير متوفر'}
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-open-product="${escapeHtml(product.id)}"
            aria-label="التفاصيل ${escapeHtml(product.name)}"
          >
            التفاصيل
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderHeroSection() {
  const { homepage, products, collections, activeOffers } = state.storefront;
  const publishedCount = products.length;
  const colsCount = collections.length;
  const offersCount = activeOffers.length;

  return `
    <section class="hero-section" id="top">
      <div class="container hero-grid">
        <div class="hero-copy">
          ${homepage.heroKicker ? `<div class="hero-kicker">${escapeHtml(homepage.heroKicker)}</div>` : ''}
          <h1 class="hero-title">${escapeHtml(homepage.heroTitle)}</h1>
          <p class="hero-description">${escapeHtml(homepage.heroDescription)}</p>

          <div class="hero-actions">
            <a href="${escapeHtml(homepage.heroPrimaryCtaLink || '#catalog')}" class="btn btn-gold">
              ${escapeHtml(homepage.heroPrimaryCtaLabel || 'استكشف التشكيلة')}
            </a>
            <a href="${escapeHtml(homepage.heroSecondaryCtaLink || '#collections')}" class="btn hero-btn-secondary">
              ${escapeHtml(homepage.heroSecondaryCtaLabel || 'المجموعات الحصرية')}
            </a>
          </div>

          <div class="hero-metrics">
            <div>
              <div class="hero-metric-val">${publishedCount}</div>
              <div class="hero-metric-label">تصميم متاح</div>
            </div>
            <div>
              <div class="hero-metric-val">${colsCount}</div>
              <div class="hero-metric-label">مجموعات حصرية</div>
            </div>
            <div>
              <div class="hero-metric-val">${offersCount > 0 ? `${activeOffers[0].discountPercent}%` : '24/7'}</div>
              <div class="hero-metric-label">${offersCount > 0 ? 'عروض فعّالة الآن' : 'طلب مباشر واتساب'}</div>
            </div>
          </div>
        </div>

        <div class="hero-media-stage">
          <div class="hero-3d-frame" id="hero-3d-frame">
            ${renderImageWithFallback(homepage.heroImage, homepage.heroTitle)}
            <div class="hero-frame-scrim"></div>
            <div class="hero-frame-caption">
              <span>خياطة معمارية · أقمشة طبيعية منتقاة</span>
              <span class="hero-frame-monogram">ORVA 7</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCollectionsSection() {
  const { collections, homepage } = state.storefront;
  if (!collections.length) return '';

  const featuredIds = homepage.featuredCollectionIds || [];
  const chosen = featuredIds.length
    ? collections.filter((c) => featuredIds.includes(c.id))
    : collections;
  const list = chosen.length ? chosen : collections;

  return `
    <section class="store-section" id="collections">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-kicker">الإصدارات المختارة</div>
            <h2 class="section-title">المجموعات الحصرية</h2>
            <p class="section-desc">كبسولات أزياء مصممة بتناغم بين الكحلي العميق والفضة والذهب الهادئ.</p>
          </div>
        </div>

        <div class="collections-grid">
          ${list
            .map(
              (col) => `
            <article class="collection-card">
              <div class="collection-media">
                ${renderImageWithFallback(col.coverImage, col.name)}
              </div>
              <div class="collection-body">
                <div>
                  <div class="collection-meta">${col.productIds.length} قطع مختارة</div>
                  <h3 class="collection-title">${escapeHtml(col.name)}</h3>
                  <p class="collection-desc">${escapeHtml(col.description)}</p>
                </div>
                <div>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    data-select-collection="${escapeHtml(col.id)}"
                  >
                    عرض قطع المجموعة
                  </button>
                </div>
              </div>
            </article>
          `
            )
            .join('')}
        </div>
      </div>
    </section>
  `;
}

function renderFeaturedSection() {
  const { products, homepage, settings } = state.storefront;
  const currency = settings.currencySymbol || 'ج.م';
  const featuredIds = homepage.featuredProductIds || [];
  let featured = products.filter((p) => p.showOnHomepage && featuredIds.includes(p.id));
  if (!featured.length) {
    featured = products.filter((p) => p.showOnHomepage && (p.isFeatured || p.isBestSeller));
  }
  featured = featured.slice(0, 6);
  if (!featured.length) return '';

  return `
    <section class="store-section store-section-subtle" id="featured">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-kicker">اختيارات الدار</div>
            <h2 class="section-title">القطع المميزة والأكثر طلباً</h2>
            <p class="section-desc">توليفة من أحدث التصاميم والأكثر مبيعاً في دار ORVA 7.</p>
          </div>
          <a href="#catalog" class="btn btn-secondary btn-sm">تصفح كل المتجر</a>
        </div>

        <div class="products-grid">
          ${featured.map((p) => renderProductCard(p, currency)).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderCatalogSection() {
  const { categories, collections, facets } = state.storefront;
  const f = state.filters;

  const topCategories = categories.filter((c) => !c.parentId);
  const childrenByParent = new Map();
  categories.forEach((c) => {
    if (c.parentId) {
      if (!childrenByParent.has(c.parentId)) childrenByParent.set(c.parentId, []);
      childrenByParent.get(c.parentId).push(c);
    }
  });

  return `
    <section class="store-section" id="catalog">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-kicker">المتجر الكامل</div>
            <h2 class="section-title">استكشف التشكيلة المتكاملة</h2>
            <p class="section-desc" id="catalog-result-count">جارٍ عرض المنتجات...</p>
          </div>

          <div class="segmented-tabs" role="tablist" aria-label="تصنيفات سريعة">
            <button type="button" class="seg-btn ${state.activeTab === 'all' ? 'is-active' : ''}" data-quick-tab="all">الكل</button>
            <button type="button" class="seg-btn ${state.activeTab === 'new' ? 'is-active' : ''}" data-quick-tab="new">وصل حديثاً</button>
            <button type="button" class="seg-btn ${state.activeTab === 'best' ? 'is-active' : ''}" data-quick-tab="best">الأكثر مبيعاً</button>
            <button type="button" class="seg-btn ${state.activeTab === 'sale' ? 'is-active' : ''}" data-quick-tab="sale">العروض والخصومات</button>
          </div>
        </div>

        <div class="catalog-toolbar">
          <div class="search-box">
            <span class="search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              id="catalog-search-input"
              class="search-input"
              placeholder="ابحث باسم القطعة، الوصف، الفئة، أو المجموعة..."
              value="${escapeHtml(f.search)}"
              aria-label="البحث في المنتجات"
            />
          </div>

          <div class="toolbar-controls">
            <label for="catalog-sort-select" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;">الترتيب</label>
            <select id="catalog-sort-select" class="select-control" aria-label="ترتيب المنتجات">
              <option value="featured" ${f.sort === 'featured' ? 'selected' : ''}>الترتيب: المميزة أولاً</option>
              <option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>الترتيب: الأحدث</option>
              <option value="price_asc" ${f.sort === 'price_asc' ? 'selected' : ''}>السعر: من الأقل للأعلى</option>
              <option value="price_desc" ${f.sort === 'price_desc' ? 'selected' : ''}>السعر: من الأعلى للأقل</option>
              <option value="best_selling" ${f.sort === 'best_selling' ? 'selected' : ''}>الأكثر مبيعاً</option>
            </select>
            <button type="button" id="reset-filters-btn" class="btn btn-secondary btn-sm">إعادة ضبط الفلاتر</button>
          </div>
        </div>

        <div class="catalog-layout">
          <aside class="filter-panel" aria-label="فلاتر التصفية المتقدمة">
            <div class="filter-group">
              <h3 class="filter-heading">الفئات</h3>
              <div class="filter-list">
                <button
                  type="button"
                  class="filter-choice-btn ${!f.categoryId ? 'is-active' : ''}"
                  data-filter-category=""
                >
                  <span>جميع الفئات</span>
                </button>
                ${topCategories
                  .map((cat) => {
                    const subs = childrenByParent.get(cat.id) || [];
                    return `
                      <button
                        type="button"
                        class="filter-choice-btn ${f.categoryId === cat.id ? 'is-active' : ''}"
                        data-filter-category="${escapeHtml(cat.id)}"
                      >
                        <span>${escapeHtml(cat.name)}</span>
                      </button>
                      ${subs
                        .map(
                          (sub) => `
                        <button
                          type="button"
                          class="filter-choice-btn filter-choice-sub ${f.categoryId === sub.id ? 'is-active' : ''}"
                          data-filter-category="${escapeHtml(sub.id)}"
                        >
                          <span>↳ ${escapeHtml(sub.name)}</span>
                        </button>
                      `
                        )
                        .join('')}
                    `;
                  })
                  .join('')}
              </div>
            </div>

            <div class="filter-group">
              <h3 class="filter-heading">المجموعات</h3>
              <div class="filter-list">
                <button
                  type="button"
                  class="filter-choice-btn ${!f.collectionId ? 'is-active' : ''}"
                  data-filter-collection=""
                >
                  <span>كل المجموعات</span>
                </button>
                ${collections
                  .map(
                    (col) => `
                  <button
                    type="button"
                    class="filter-choice-btn ${f.collectionId === col.id ? 'is-active' : ''}"
                    data-filter-collection="${escapeHtml(col.id)}"
                  >
                    <span>${escapeHtml(col.name)}</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="filter-group">
              <h3 class="filter-heading">المقاس</h3>
              <div class="size-chips">
                ${(facets.sizes || [])
                  .map(
                    (sz) => `
                  <button
                    type="button"
                    class="size-chip ${f.size === sz ? 'is-active' : ''}"
                    data-filter-size="${escapeHtml(sz)}"
                  >
                    ${escapeHtml(sz)}
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="filter-group">
              <h3 class="filter-heading">اللون</h3>
              <div class="color-swatches">
                ${(facets.colors || [])
                  .map(
                    (c) => `
                  <button
                    type="button"
                    class="color-swatch-btn ${f.color === c.name ? 'is-active' : ''}"
                    data-filter-color="${escapeHtml(c.name)}"
                  >
                    <span class="swatch-dot" style="background:${escapeHtml(c.hex)}"></span>
                    <span>${escapeHtml(c.name)}</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="filter-group">
              <h3 class="filter-heading">نطاق السعر</h3>
              <div class="price-inputs">
                <input
                  type="number"
                  id="filter-min-price"
                  class="price-input"
                  placeholder="من"
                  value="${escapeHtml(f.minPrice)}"
                  aria-label="أدنى سعر"
                />
                <input
                  type="number"
                  id="filter-max-price"
                  class="price-input"
                  placeholder="إلى"
                  value="${escapeHtml(f.maxPrice)}"
                  aria-label="أعلى سعر"
                />
              </div>
            </div>

            <div class="filter-group">
              <h3 class="filter-heading">حالة التشكيلة</h3>
              <label class="check-label">
                <input type="checkbox" id="filter-sale-only" ${f.onSaleOnly ? 'checked' : ''} />
                <span>العروض والخصومات فقط</span>
              </label>
              <label class="check-label">
                <input type="checkbox" id="filter-new-only" ${f.newArrivalOnly ? 'checked' : ''} />
                <span>وصل حديثاً فقط</span>
              </label>
              <label class="check-label">
                <input type="checkbox" id="filter-best-only" ${f.bestSellerOnly ? 'checked' : ''} />
                <span>الأكثر مبيعاً فقط</span>
              </label>
            </div>
          </aside>

          <div id="catalog-products-container"></div>
        </div>
      </div>
    </section>
  `;
}

function renderBannersSection() {
  const banners = (state.storefront.homepage.promoBanners || []).filter((b) => b.isVisible);
  if (!banners.length) return '';

  return `
    <section class="store-section store-section-subtle" id="promotions">
      <div class="container banners-stack">
        ${banners
          .map(
            (b) => `
          <div class="promo-banner-card">
            <div class="promo-banner-copy">
              <h3>${escapeHtml(b.title)}</h3>
              <p>${escapeHtml(b.subtitle)}</p>
              <div>
                <a href="${escapeHtml(b.ctaLink || '#catalog')}" class="btn btn-gold">
                  ${escapeHtml(b.ctaLabel || 'اكتشف المزيد')}
                </a>
              </div>
            </div>
            <div class="promo-banner-media">
              ${renderImageWithFallback(b.image, b.title)}
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderEditorialSection() {
  const { settings } = state.storefront;
  return `
    <section class="store-section" id="editorial">
      <div class="container">
        <div class="section-head">
          <div>
            <div class="section-kicker">الهوية والحرفية</div>
            <h2 class="section-title">فلسفة دار ${escapeHtml(settings.storeName || 'ORVA 7')}</h2>
            <p class="section-desc">${escapeHtml(settings.storeDescription)}</p>
          </div>
        </div>

        <div class="pillars-grid">
          <div class="pillar-card">
            <div class="pillar-index">01</div>
            <h3 class="pillar-title">تصميم معماري متوازن</h3>
            <p class="pillar-desc">كل قطعة تُصمم وفق خطوط هندسية نظيفة تمنح حضوراً واثقاً وانسيابية فاخرة في الحركة.</p>
          </div>
          <div class="pillar-card">
            <div class="pillar-index">02</div>
            <h3 class="pillar-title">خامات طبيعية منتقاة</h3>
            <p class="pillar-desc">نعتمد على صوف الكشمير البكر، حرير التوت، والغاباردين المنسوج بعناية لضمان الجودة المستدامة.</p>
          </div>
          <div class="pillar-card">
            <div class="pillar-index">03</div>
            <h3 class="pillar-title">خدمة طلب شخصية عبر واتساب</h3>
            <p class="pillar-desc">تأكيد فوري للمقاسات والتوصيل المخصص عبر فريق خدمة عملاء ORVA 7 مباشرة على واتساب.</p>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderStorefrontPage() {
  const main = document.getElementById('storefront-main');
  if (!main || !state.storefront) return;

  const sections = [...(state.storefront.homepage.sections || [])]
    .filter((s) => s.isVisible)
    .sort((a, b) => a.order - b.order);

  const rendererMap = {
    hero: renderHeroSection,
    collections: renderCollectionsSection,
    featured: renderFeaturedSection,
    catalog: renderCatalogSection,
    banners: renderBannersSection,
    editorial: renderEditorialSection,
  };

  main.innerHTML = sections.map((sec) => (rendererMap[sec.id] ? rendererMap[sec.id]() : '')).join('');
  attachHero3DTilt();
  attachCatalogHandlers();
  renderCatalogProductsGrid();
  bindProductTriggers(main);
}

function attachHero3DTilt() {
  const frame = document.getElementById('hero-3d-frame');
  if (!frame) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  frame.addEventListener('mousemove', (e) => {
    const rect = frame.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    frame.style.transform = `rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
  });
  frame.addEventListener('mouseleave', () => {
    frame.style.transform = 'rotateY(0deg) rotateX(0deg)';
  });
}

function renderCatalogProductsGrid() {
  const container = document.getElementById('catalog-products-container');
  const countLabel = document.getElementById('catalog-result-count');
  if (!container) return;

  const currency = state.storefront?.settings?.currencySymbol || 'ج.م';
  const items = state.filteredProducts || [];

  if (countLabel) {
    countLabel.textContent = `عرض ${items.length} من إجمالي ${state.storefront.products.length} قطعة منشورة`;
  }

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>لا توجد منتجات مطابقة لخيارات البحث</h3>
        <p>جرب تعديل كلمات البحث أو إزالة بعض الفلاتر لعرض جميع تصاميم ORVA 7 المتاحة.</p>
        <button type="button" class="btn btn-primary" id="empty-reset-btn">عرض جميع المنتجات</button>
      </div>
    `;
    document.getElementById('empty-reset-btn')?.addEventListener('click', resetAllFilters);
    return;
  }

  container.innerHTML = `
    <div class="products-grid">
      ${items.map((p) => renderProductCard(p, currency)).join('')}
    </div>
  `;
  bindProductTriggers(container);
}

async function applyCatalogFiltersAndRender(scrollToCatalog = false) {
  const f = state.filters;
  const params = new URLSearchParams();
  if (f.search.trim()) params.set('search', f.search.trim());
  if (f.categoryId) params.set('categoryId', f.categoryId);
  if (f.collectionId) params.set('collectionId', f.collectionId);
  if (f.size) params.set('size', f.size);
  if (f.color) params.set('color', f.color);
  if (f.minPrice !== '') params.set('minPrice', f.minPrice);
  if (f.maxPrice !== '') params.set('maxPrice', f.maxPrice);
  if (f.onSaleOnly) params.set('onSaleOnly', 'true');
  if (f.newArrivalOnly) params.set('newArrivalOnly', 'true');
  if (f.bestSellerOnly) params.set('bestSellerOnly', 'true');
  if (f.sort) params.set('sort', f.sort);

  try {
    const res = await apiFetch(`/api/products?${params.toString()}`);
    state.filteredProducts = res.products || [];
  } catch (err) {
    showToast(err.message || 'تعذر تحديث قائمة المنتجات.', 'error');
  }

  // Sync active visual classes in filter panel without rebuilding the whole page
  document.querySelectorAll('[data-filter-category]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-filter-category') === f.categoryId);
  });
  document.querySelectorAll('[data-filter-collection]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-filter-collection') === f.collectionId);
  });
  document.querySelectorAll('[data-filter-size]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-filter-size') === f.size);
  });
  document.querySelectorAll('[data-filter-color]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-filter-color') === f.color);
  });
  document.querySelectorAll('[data-quick-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-quick-tab') === state.activeTab);
  });

  renderCatalogProductsGrid();
  if (scrollToCatalog) {
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
  }
}

function resetAllFilters() {
  state.filters = {
    search: '',
    categoryId: '',
    collectionId: '',
    size: '',
    color: '',
    minPrice: '',
    maxPrice: '',
    onSaleOnly: false,
    newArrivalOnly: false,
    bestSellerOnly: false,
    sort: 'featured',
  };
  state.activeTab = 'all';

  const searchInput = document.getElementById('catalog-search-input');
  const sortSelect = document.getElementById('catalog-sort-select');
  const minInput = document.getElementById('filter-min-price');
  const maxInput = document.getElementById('filter-max-price');
  const saleCheck = document.getElementById('filter-sale-only');
  const newCheck = document.getElementById('filter-new-only');
  const bestCheck = document.getElementById('filter-best-only');

  if (searchInput) searchInput.value = '';
  if (sortSelect) sortSelect.value = 'featured';
  if (minInput) minInput.value = '';
  if (maxInput) maxInput.value = '';
  if (saleCheck) saleCheck.checked = false;
  if (newCheck) newCheck.checked = false;
  if (bestCheck) bestCheck.checked = false;

  applyCatalogFiltersAndRender(false);
}

let searchDebounceTimer = null;

function attachCatalogHandlers() {
  document.getElementById('catalog-search-input')?.addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => applyCatalogFiltersAndRender(false), 180);
  });

  document.getElementById('catalog-sort-select')?.addEventListener('change', (e) => {
    state.filters.sort = e.target.value;
    applyCatalogFiltersAndRender(false);
  });

  document.getElementById('reset-filters-btn')?.addEventListener('click', resetAllFilters);

  document.querySelectorAll('[data-filter-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filters.categoryId = btn.getAttribute('data-filter-category') || '';
      applyCatalogFiltersAndRender(false);
    });
  });

  document.querySelectorAll('[data-filter-collection]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filters.collectionId = btn.getAttribute('data-filter-collection') || '';
      applyCatalogFiltersAndRender(false);
    });
  });

  document.querySelectorAll('[data-select-collection]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filters.collectionId = btn.getAttribute('data-select-collection') || '';
      applyCatalogFiltersAndRender(true);
    });
  });

  document.querySelectorAll('[data-filter-size]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-filter-size') || '';
      state.filters.size = state.filters.size === val ? '' : val;
      applyCatalogFiltersAndRender(false);
    });
  });

  document.querySelectorAll('[data-filter-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-filter-color') || '';
      state.filters.color = state.filters.color === val ? '' : val;
      applyCatalogFiltersAndRender(false);
    });
  });

  document.getElementById('filter-min-price')?.addEventListener('input', (e) => {
    state.filters.minPrice = e.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => applyCatalogFiltersAndRender(false), 220);
  });

  document.getElementById('filter-max-price')?.addEventListener('input', (e) => {
    state.filters.maxPrice = e.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => applyCatalogFiltersAndRender(false), 220);
  });

  const syncChecks = () => {
    const saleCheck = document.getElementById('filter-sale-only');
    const newCheck = document.getElementById('filter-new-only');
    const bestCheck = document.getElementById('filter-best-only');
    if (saleCheck) saleCheck.checked = state.filters.onSaleOnly;
    if (newCheck) newCheck.checked = state.filters.newArrivalOnly;
    if (bestCheck) bestCheck.checked = state.filters.bestSellerOnly;
  };

  document.getElementById('filter-sale-only')?.addEventListener('change', (e) => {
    state.filters.onSaleOnly = e.target.checked;
    applyCatalogFiltersAndRender(false);
  });
  document.getElementById('filter-new-only')?.addEventListener('change', (e) => {
    state.filters.newArrivalOnly = e.target.checked;
    applyCatalogFiltersAndRender(false);
  });
  document.getElementById('filter-best-only')?.addEventListener('change', (e) => {
    state.filters.bestSellerOnly = e.target.checked;
    applyCatalogFiltersAndRender(false);
  });

  document.querySelectorAll('[data-quick-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-quick-tab') || 'all';
      state.activeTab = tab;
      state.filters.onSaleOnly = tab === 'sale';
      state.filters.newArrivalOnly = tab === 'new';
      state.filters.bestSellerOnly = tab === 'best';
      syncChecks();
      applyCatalogFiltersAndRender(false);
    });
  });
}

function bindProductTriggers(scope) {
  scope.querySelectorAll('[data-open-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-open-product');
      if (id) openProductDetail(id);
    });
  });

  scope.querySelectorAll('[data-toggle-wishlist]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-toggle-wishlist');
      if (id) toggleWishlistItem(id);
    });
  });

  scope.querySelectorAll('[data-quick-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-quick-add');
      const product = findProductById(id);
      if (!product) return;
      addToCart(
        product,
        product.sizes[0] || 'M',
        product.colors[0]?.name || 'أساسي',
        1
      );
      openCartDrawer();
    });
  });
}

// ==========================================
// Product Detail View (PDP) + Zoom + Reviews
// ==========================================

async function openProductDetail(idOrSlug) {
  const dialog = document.getElementById('product-detail-dialog');
  const content = document.getElementById('pdp-content');
  if (!dialog || !content) return;

  content.innerHTML = `<div style="padding:2rem;text-align:center;">جارٍ تحميل تفاصيل القطعة...</div>`;
  if (!dialog.open) dialog.showModal();

  try {
    const res = await apiFetch(`/api/products/${encodeURIComponent(idOrSlug)}`);
    const product = res.product;
    const related = res.related || [];
    state.pdpState = {
      product,
      reviews: res.reviews || [],
      canReview: Boolean(res.canReview),
      reviewRating: 5,
      selectedImageIdx: 0,
      selectedSize: product.sizes[0] || 'M',
      selectedColor: product.colors[0]?.name || 'أساسي',
      quantity: 1,
      isZoomed: false,
    };
    renderPdpContent(related);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>تعذر فتح المنتج</h3><p>${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="pdp-fail-close">إغلاق</button></div>`;
    document.getElementById('pdp-fail-close')?.addEventListener('click', () => dialog.close());
  }
}

function renderPdpContent(related = []) {
  const dialog = document.getElementById('product-detail-dialog');
  const content = document.getElementById('pdp-content');
  const p = state.pdpState.product;
  if (!content || !p) return;

  const currency = state.storefront?.settings?.currencySymbol || 'ج.م';
  const pricing = p.pricing || {
    basePrice: p.price,
    finalPrice: p.price,
    hasDiscount: false,
    discountPercent: 0,
  };
  const revSum = p.reviewSummary || { averageRating: 0, reviewCount: 0 };
  const reviews = state.pdpState.reviews || [];
  const images = p.images.length ? p.images : [''];
  const currentImg = images[state.pdpState.selectedImageIdx] || images[0];
  const saved = isWishlisted(p.id);

  content.innerHTML = `
    <div class="pdp-topbar">
      <div class="product-meta-line">
        <span>${escapeHtml(getCategoryName(p.categoryId))}</span>
        <span aria-hidden="true"> · </span>
        <span>${p.stock > 0 ? `متوفر (${p.stock} قطعة)` : 'نفذت الكمية'}</span>
      </div>
      <button type="button" id="close-pdp-btn" class="icon-btn" aria-label="إغلاق نافذة المنتج">✕</button>
    </div>

    <div class="pdp-grid">
      <div class="pdp-gallery">
        <div class="pdp-zoom-stage ${state.pdpState.isZoomed ? 'is-zoomed' : ''}" id="pdp-zoom-stage" title="انقر للتكبير أو حرّك المؤشر">
          ${renderImageWithFallback(currentImg, p.name, 'pdp-main-img')}
        </div>
        ${
          images.length > 1
            ? `
          <div class="pdp-thumbs">
            ${images
              .map(
                (img, idx) => `
              <button
                type="button"
                class="pdp-thumb-btn ${idx === state.pdpState.selectedImageIdx ? 'is-active' : ''}"
                data-pdp-thumb="${idx}"
                aria-label="عرض الصورة ${idx + 1}"
              >
                ${renderImageWithFallback(img, p.name)}
              </button>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>

      <div class="pdp-details">
        <h2 class="pdp-title" id="pdp-title">${escapeHtml(p.name)}</h2>

        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
          ${renderStarsHtml(revSum.averageRating, revSum.reviewCount)}
        </div>

        <div class="pdp-price-wrap">
          ${
            p.showPrice
              ? `<span class="pdp-price-main">${escapeHtml(formatPrice(pricing.finalPrice, currency))}</span>
                 ${
                   pricing.hasDiscount
                     ? `<span class="price-old">${escapeHtml(formatPrice(pricing.basePrice, currency))}</span>
                        <span style="font-size:0.84rem;color:var(--gold-600);font-weight:600;">وفر ${pricing.discountPercent}%</span>`
                     : ''
                 }`
              : `<span class="pdp-price-main">السعر عند التواصل</span>`
          }
        </div>

        <p class="pdp-description">${escapeHtml(p.description)}</p>

        <div>
          <span class="pdp-option-label">المقاس المختار: <strong id="pdp-size-val">${escapeHtml(state.pdpState.selectedSize)}</strong></span>
          <div class="size-chips">
            ${p.sizes
              .map(
                (sz) => `
              <button
                type="button"
                class="size-chip ${state.pdpState.selectedSize === sz ? 'is-active' : ''}"
                data-pdp-size="${escapeHtml(sz)}"
              >
                ${escapeHtml(sz)}
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div>
          <span class="pdp-option-label">اللون المختار: <strong id="pdp-color-val">${escapeHtml(state.pdpState.selectedColor)}</strong></span>
          <div class="color-swatches">
            ${p.colors
              .map(
                (c) => `
              <button
                type="button"
                class="color-swatch-btn ${state.pdpState.selectedColor === c.name ? 'is-active' : ''}"
                data-pdp-color="${escapeHtml(c.name)}"
              >
                <span class="swatch-dot" style="background:${escapeHtml(c.hex)}"></span>
                <span>${escapeHtml(c.name)}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-top:0.5rem;">
          <div class="qty-stepper" aria-label="الكمية">
            <button type="button" id="pdp-qty-dec" aria-label="إنقاص الكمية">−</button>
            <span id="pdp-qty-val">${state.pdpState.quantity}</span>
            <button type="button" id="pdp-qty-inc" aria-label="زيادة الكمية">+</button>
          </div>

          <button
            type="button"
            id="pdp-add-to-cart"
            class="btn btn-primary"
            style="flex:1;"
            ${p.stock <= 0 ? 'disabled' : ''}
          >
            ${p.stock > 0 ? 'أضف إلى حقيبة التسوق' : 'غير متوفر حالياً'}
          </button>

          <button
            type="button"
            class="btn btn-secondary"
            data-toggle-wishlist="${escapeHtml(p.id)}"
            aria-pressed="${saved}"
          >
            ${saved ? '♥ بالمفضلة' : '♡ حفظ بالمفضلة'}
          </button>
        </div>
      </div>
    </div>

    <section class="pdp-reviews-section" aria-label="تقييمات ومراجعات العملاء">
      <div class="pdp-reviews-head">
        <div>
          <h3 style="margin:0;font-size:1.1rem;color:var(--navy-900);">تقييمات ومراجعات العملاء</h3>
          <p style="margin:0.2rem 0 0;font-size:0.84rem;color:var(--text-muted);">
            تقييمات موثقة من عملاء قاموا بشراء هذه القطعة فعلياً.
          </p>
        </div>
        <div>${renderStarsHtml(revSum.averageRating, revSum.reviewCount)}</div>
      </div>

      <div class="pdp-reviews-grid">
        <div class="review-form-card">
          <h4 style="margin:0;font-size:0.95rem;color:var(--navy-900);">أضف تقييمك للقطعة</h4>
          ${
            state.pdpState.canReview
              ? `
            <form id="pdp-review-form" class="checkout-form" novalidate>
              <div>
                <span class="pdp-option-label">التقييم بالنجوم *</span>
                <div class="star-picker-row" id="pdp-star-picker">
                  ${[1, 2, 3, 4, 5]
                    .map(
                      (n) => `
                    <button
                      type="button"
                      class="star-pick-btn ${n <= state.pdpState.reviewRating ? 'is-active' : ''}"
                      data-pick-star="${n}"
                      aria-label="${n} نجوم"
                    >
                      ★
                    </button>
                  `
                    )
                    .join('')}
                </div>
              </div>
              <div class="field-group">
                <label for="rev-title">عنوان المراجعة (اختياري)</label>
                <input id="rev-title" name="title" type="text" class="field-input" placeholder="مثال: خامة ممتازة وقصة راقية" />
              </div>
              <div class="field-group">
                <label for="rev-comment">تفاصيل تجربتك *</label>
                <textarea id="rev-comment" name="comment" class="field-input" style="min-height:84px;" required placeholder="شاركنا رأيك في الخامة والمقاس والتشطيب..."></textarea>
              </div>
              <div id="pdp-review-error" class="form-error-box" hidden></div>
              <button type="submit" id="pdp-review-submit" class="btn btn-primary btn-sm">نشر التقييم</button>
            </form>
          `
              : `
            <p style="margin:0;font-size:0.86rem;color:var(--text-secondary);line-height:1.6;">
              ${
                state.customer
                  ? 'يمكنك كتابة تقييم ومراجعة لهذه القطعة بمجرد إتمام شرائها من متجر ORVA 7 لضمان مصداقية التقييمات.'
                  : 'ميزة كتابة التقييم متاحة لعملاء دار ORVA 7 المسجلين الذين قاموا بشراء هذه القطعة.'
              }
            </p>
            ${
              !state.customer
                ? `<div><button type="button" id="pdp-login-for-review" class="btn btn-secondary btn-sm">تسجيل الدخول لحسابك</button></div>`
                : ''
            }
          `
          }
        </div>

        <div class="reviews-list">
          ${
            reviews.length
              ? reviews
                  .map(
                    (r) => `
                <article class="review-item-card">
                  <div class="review-item-top">
                    <strong>${escapeHtml(r.customerName)}</strong>
                    <span class="review-verified-note">✓ مشتري مؤكد</span>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
                    ${renderStarsHtml(r.rating)}
                    <span style="font-size:0.74rem;color:var(--text-muted);">${escapeHtml(formatDateAr(r.createdAt))}</span>
                  </div>
                  ${r.title ? `<strong style="font-size:0.88rem;color:var(--navy-900);">${escapeHtml(r.title)}</strong>` : ''}
                  <p style="margin:0;font-size:0.86rem;color:var(--text-secondary);">${escapeHtml(r.comment)}</p>
                </article>
              `
                  )
                  .join('')
              : `<div class="review-item-card"><p style="margin:0;color:var(--text-muted);font-size:0.86rem;">لا توجد مراجعات مكتوبة لهذه القطعة حتى الآن.</p></div>`
          }
        </div>
      </div>
    </section>

    ${
      related.length
        ? `
      <div class="pdp-related">
        <h3 style="margin:0 0 1rem;font-size:1.05rem;color:var(--navy-900);">قطع مقترحة من نفس الذوق</h3>
        <div class="pdp-related-grid">
          ${related
            .map(
              (rp) => `
            <button
              type="button"
              class="product-card"
              style="padding:0;text-align:right;"
              data-open-related="${escapeHtml(rp.id)}"
            >
              <div class="product-media-btn" style="pointer-events:none;">
                ${renderImageWithFallback(rp.images[0] || '', rp.name)}
              </div>
              <div class="product-body">
                <div style="font-weight:600;font-size:0.88rem;color:var(--navy-900);">${escapeHtml(rp.name)}</div>
                <div class="price-final" style="font-size:0.88rem;">${escapeHtml(formatPrice(rp.pricing.finalPrice, currency))}</div>
              </div>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `
        : ''
    }
  `;

  document.getElementById('close-pdp-btn')?.addEventListener('click', () => dialog.close());

  const zoomStage = document.getElementById('pdp-zoom-stage');
  const zoomImg = zoomStage?.querySelector('img');
  if (zoomStage && zoomImg) {
    zoomStage.addEventListener('click', () => {
      state.pdpState.isZoomed = !state.pdpState.isZoomed;
      zoomStage.classList.toggle('is-zoomed', state.pdpState.isZoomed);
    });
    zoomStage.addEventListener('mousemove', (e) => {
      if (!state.pdpState.isZoomed) return;
      const rect = zoomStage.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top) / rect.height) * 100;
      zoomImg.style.transformOrigin = `${xPct}% ${yPct}%`;
    });
    zoomStage.addEventListener('mouseleave', () => {
      state.pdpState.isZoomed = false;
      zoomStage.classList.remove('is-zoomed');
    });
  }

  content.querySelectorAll('[data-pdp-thumb]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pdpState.selectedImageIdx = Number(btn.getAttribute('data-pdp-thumb') || 0);
      state.pdpState.isZoomed = false;
      renderPdpContent(related);
    });
  });

  content.querySelectorAll('[data-pdp-size]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pdpState.selectedSize = btn.getAttribute('data-pdp-size') || '';
      content.querySelectorAll('[data-pdp-size]').forEach((b) =>
        b.classList.toggle('is-active', b === btn)
      );
      const label = document.getElementById('pdp-size-val');
      if (label) label.textContent = state.pdpState.selectedSize;
    });
  });

  content.querySelectorAll('[data-pdp-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pdpState.selectedColor = btn.getAttribute('data-pdp-color') || '';
      content.querySelectorAll('[data-pdp-color]').forEach((b) =>
        b.classList.toggle('is-active', b === btn)
      );
      const label = document.getElementById('pdp-color-val');
      if (label) label.textContent = state.pdpState.selectedColor;
    });
  });

  document.getElementById('pdp-qty-dec')?.addEventListener('click', () => {
    state.pdpState.quantity = Math.max(1, state.pdpState.quantity - 1);
    const val = document.getElementById('pdp-qty-val');
    if (val) val.textContent = String(state.pdpState.quantity);
  });

  document.getElementById('pdp-qty-inc')?.addEventListener('click', () => {
    state.pdpState.quantity = Math.min(Math.max(1, p.stock), state.pdpState.quantity + 1);
    const val = document.getElementById('pdp-qty-val');
    if (val) val.textContent = String(state.pdpState.quantity);
  });

  document.getElementById('pdp-add-to-cart')?.addEventListener('click', () => {
    addToCart(
      p,
      state.pdpState.selectedSize,
      state.pdpState.selectedColor,
      state.pdpState.quantity
    );
    dialog.close();
    openCartDrawer();
  });

  content.querySelectorAll('[data-toggle-wishlist]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await toggleWishlistItem(p.id);
      const nowSaved = isWishlisted(p.id);
      btn.textContent = nowSaved ? '♥ بالمفضلة' : '♡ حفظ بالمفضلة';
    });
  });

  document.getElementById('pdp-login-for-review')?.addEventListener('click', () => {
    dialog.close();
    state.accountTab = 'login';
    openAccountModal();
  });

  content.querySelectorAll('[data-pick-star]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pdpState.reviewRating = Number(btn.getAttribute('data-pick-star') || 5);
      content.querySelectorAll('[data-pick-star]').forEach((b) => {
        const val = Number(b.getAttribute('data-pick-star') || 0);
        b.classList.toggle('is-active', val <= state.pdpState.reviewRating);
      });
    });
  });

  document.getElementById('pdp-review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const errBox = document.getElementById('pdp-review-error');
    const submitBtn = document.getElementById('pdp-review-submit');
    if (errBox) errBox.hidden = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'جارٍ النشر...';
    }
    try {
      const res = await apiFetch(`/api/products/${encodeURIComponent(p.id)}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          rating: state.pdpState.reviewRating,
          title: String(fd.get('title') || '').trim(),
          comment: String(fd.get('comment') || '').trim(),
        }),
      });
      state.pdpState.reviews = res.reviews || [];
      state.pdpState.product.reviewSummary = res.reviewSummary;
      showToast('شكراً لك! تم نشر تقييمك بنجاح.');
      await refreshStorefrontData(true);
      renderPdpContent(related);
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message || 'تعذر نشر التقييم.';
        errBox.hidden = false;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'نشر التقييم';
      }
    }
  });

  content.querySelectorAll('[data-open-related]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-open-related');
      if (id) openProductDetail(id);
    });
  });
}

// ==========================================
// Shopping Cart & WhatsApp Order Flow
// ==========================================

function addToCart(product, size, color, quantity = 1) {
  if (product.stock <= 0) {
    showToast('هذه القطعة غير متوفرة حالياً في المخزون.', 'error');
    return;
  }

  state.lastOrderReceipt = null;
  const pricing = product.pricing || { finalPrice: product.price };
  const existingIdx = state.cart.findIndex(
    (item) => item.productId === product.id && item.size === size && item.color === color
  );

  if (existingIdx >= 0) {
    const nextQty = Math.min(product.stock, state.cart[existingIdx].quantity + quantity);
    state.cart[existingIdx].quantity = nextQty;
    state.cart[existingIdx].unitPrice = pricing.finalPrice;
  } else {
    state.cart.push({
      productId: product.id,
      productName: product.name,
      size,
      color,
      quantity: Math.min(product.stock, quantity),
      unitPrice: pricing.finalPrice,
      image: product.images[0] || '',
      maxStock: product.stock,
    });
  }

  saveCartToStorage();
  updateCartBadge();
  showToast(`تمت إضافة "${product.name}" إلى حقيبة التسوق.`);
}

function openCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const backdrop = document.getElementById('cart-backdrop');
  if (!drawer || !backdrop) return;
  renderCartDrawer();
  backdrop.hidden = false;
  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
}

function closeCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const backdrop = document.getElementById('cart-backdrop');
  if (!drawer || !backdrop) return;
  backdrop.hidden = true;
  drawer.hidden = true;
  drawer.setAttribute('aria-hidden', 'true');
}

function renderCartDrawer() {
  const body = document.getElementById('cart-body');
  const footer = document.getElementById('cart-footer');
  const summaryEl = document.getElementById('cart-items-summary');
  if (!body || !footer) return;

  const currency = state.storefront?.settings?.currencySymbol || 'ج.م';
  const totalCount = state.cart.reduce((s, i) => s + i.quantity, 0);
  if (summaryEl) summaryEl.textContent = `${totalCount} قطع مختارة`;

  if (state.lastOrderReceipt) {
    const { order, whatsapp, receipt } = state.lastOrderReceipt;
    const isPaid = order.paymentStatus === 'paid';
    body.innerHTML = `
      <div class="order-confirmation-box">
        ${
          isPaid
            ? `<div class="payment-receipt-badge"><span>✓ تم تأكيد الدفع الإلكتروني بنجاح</span><span class="tabular-nums">${escapeHtml(order.paymentReference || receipt?.reference || '')}</span></div>`
            : ''
        }
        <h3 style="margin:0;color:var(--navy-900);">${isPaid ? 'تم الدفع وتسجيل الطلب بنجاح' : 'تم تسجيل طلبك بنجاح'}</h3>
        <p style="margin:0;font-size:0.9rem;color:var(--text-secondary);">
          رقم الطلب: <strong class="tabular-nums">${escapeHtml(order.orderNumber)}</strong>
        </p>
        <p style="margin:0;font-size:0.86rem;color:var(--text-secondary);">
          وسيلة الدفع: <strong>${escapeHtml(PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod)}</strong>
        </p>
        <p style="margin:0;font-size:0.86rem;color:var(--text-secondary);">
          الإجمالي: <strong>${escapeHtml(formatPrice(order.totalPrice, currency))}</strong>
        </p>
        <pre style="margin:0;white-space:pre-wrap;font-family:var(--font-sans);font-size:0.82rem;background:#fff;padding:0.75rem;border:1px solid var(--border-hairline);border-radius:6px;">${escapeHtml(whatsapp.message)}</pre>
        <a
          href="${escapeHtml(whatsapp.url)}"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-gold"
        >
          ${isPaid ? 'إرسال نسخة التأكيد عبر واتساب' : 'إرسال الطلب الآن عبر واتساب'}
        </a>
        <button type="button" id="cart-continue-after-order" class="btn btn-secondary">
          متابعة التسوق
        </button>
      </div>
    `;
    footer.innerHTML = '';
    document.getElementById('cart-continue-after-order')?.addEventListener('click', () => {
      state.lastOrderReceipt = null;
      closeCartDrawer();
    });
    return;
  }

  if (!state.cart.length) {
    body.innerHTML = `
      <div class="empty-state" style="margin-top:2rem;">
        <h3>حقيبة التسوق فارغة</h3>
        <p>أضف قطعاً من تشكيلة ORVA 7 للدفع الإلكتروني الآمن أو الطلب مباشرة عبر واتساب.</p>
        <button type="button" class="btn btn-primary" id="empty-cart-continue">تصفح المنتجات</button>
      </div>
    `;
    footer.innerHTML = '';
    document.getElementById('empty-cart-continue')?.addEventListener('click', closeCartDrawer);
    return;
  }

  let subtotal = 0;
  body.innerHTML = state.cart
    .map((item, idx) => {
      const liveProd = findProductById(item.productId);
      const unitPrice = liveProd?.pricing?.finalPrice ?? item.unitPrice;
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      return `
        <div class="cart-item-row">
          ${renderImageWithFallback(item.image, item.productName, 'cart-item-img')}
          <div class="cart-item-info">
            <div class="cart-item-top">
              <span class="cart-item-name">${escapeHtml(item.productName)}</span>
              <button type="button" class="btn btn-ghost btn-sm" data-cart-remove="${idx}" aria-label="حذف ${escapeHtml(item.productName)}">✕</button>
            </div>
            <div class="cart-item-meta">المقاس: ${escapeHtml(item.size)} · اللون: ${escapeHtml(item.color)}</div>
            <div class="cart-item-controls">
              <div class="qty-stepper">
                <button type="button" data-cart-dec="${idx}" aria-label="إنقاص الكمية">−</button>
                <span>${item.quantity}</span>
                <button type="button" data-cart-inc="${idx}" aria-label="زيادة الكمية">+</button>
              </div>
              <strong class="tabular-nums">${escapeHtml(formatPrice(lineTotal, currency))}</strong>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  const pm = state.checkoutPaymentMethod || 'online_card';
  const stripeEnabled = Boolean(state.storefront?.stripeEnabled);
  const cust = state.customer;

  footer.innerHTML = `
    <div class="cart-summary-line">
      <span>المجموع الفرعي والإجمالي</span>
      <span>${escapeHtml(formatPrice(subtotal, currency))}</span>
    </div>

    <form id="whatsapp-checkout-form" class="checkout-form" novalidate>
      <div class="field-group">
        <label>وسيلة الدفع وإتمام الطلب</label>
        <div class="payment-methods-grid">
          <button type="button" class="payment-choice-btn ${pm === 'online_card' ? 'is-active' : ''}" data-pay-method="online_card">
            <span>بطاقة بنكية أونلاين</span>
            <small>Visa · Mastercard · Meeza</small>
          </button>
          <button type="button" class="payment-choice-btn ${pm === 'online_wallet' ? 'is-active' : ''}" data-pay-method="online_wallet">
            <span>محفظة إلكترونية</span>
            <small>Vodafone Cash · InstaPay</small>
          </button>
          ${
            stripeEnabled
              ? `<button type="button" class="payment-choice-btn ${pm === 'stripe' ? 'is-active' : ''}" data-pay-method="stripe">
                  <span>بوابة Stripe الدولية</span>
                  <small>دفع آمن عبر Stripe Checkout</small>
                </button>`
              : ''
          }
          <button type="button" class="payment-choice-btn ${pm === 'whatsapp_cod' ? 'is-active' : ''}" data-pay-method="whatsapp_cod">
            <span>طلب عبر واتساب</span>
            <small>الدفع عند الاستلام</small>
          </button>
        </div>
      </div>

      ${
        pm === 'online_card'
          ? `
        <div class="payment-subform">
          <div class="field-group">
            <label for="pay-card-holder">اسم حامل البطاقة *</label>
            <input id="pay-card-holder" name="cardHolder" type="text" class="field-input" placeholder="الاسم كما يظهر على البطاقة" value="${escapeHtml(cust?.name || '')}" />
          </div>
          <div class="field-group">
            <label for="pay-card-number">رقم البطاقة *</label>
            <input id="pay-card-number" name="cardNumber" type="text" inputmode="numeric" maxlength="23" class="field-input tabular-nums" placeholder="4242 4242 4242 4242" />
          </div>
          <div class="payment-grid-2">
            <div class="field-group">
              <label for="pay-card-expiry">تاريخ الانتهاء *</label>
              <input id="pay-card-expiry" name="expiry" type="text" maxlength="5" class="field-input tabular-nums" placeholder="12/28" />
            </div>
            <div class="field-group">
              <label for="pay-card-cvv">CVV *</label>
              <input id="pay-card-cvv" name="cvv" type="password" inputmode="numeric" maxlength="4" class="field-input tabular-nums" placeholder="123" />
            </div>
          </div>
        </div>
      `
          : pm === 'online_wallet'
            ? `
        <div class="payment-subform">
          <div class="field-group">
            <label for="pay-wallet-phone">رقم المحفظة / InstaPay *</label>
            <input id="pay-wallet-phone" name="walletPhone" type="tel" class="field-input tabular-nums" placeholder="010XXXXXXXX" value="${escapeHtml(cust?.phone || '')}" />
          </div>
        </div>
      `
            : ''
      }

      <div class="field-group">
        <label for="checkout-name">الاسم الكامل *</label>
        <input id="checkout-name" name="customerName" type="text" class="field-input" required placeholder="مثال: سارة محمود" value="${escapeHtml(cust?.name || '')}" />
      </div>
      <div class="field-group">
        <label for="checkout-phone">رقم الهاتف / واتساب *</label>
        <input id="checkout-phone" name="customerPhone" type="tel" class="field-input" required placeholder="010XXXXXXXX" value="${escapeHtml(cust?.phone || '')}" />
      </div>
      <div class="field-group">
        <label for="checkout-address">العنوان</label>
        <input id="checkout-address" name="customerAddress" type="text" class="field-input" placeholder="المدينة - الحي - الشارع" value="${escapeHtml(cust?.address || '')}" />
      </div>
      <div class="field-group">
        <label for="checkout-notes">ملاحظات إضافية (اختياري)</label>
        <input id="checkout-notes" name="customerNotes" type="text" class="field-input" placeholder="ميعاد مناسب للتوصيل..." />
      </div>
      <div id="checkout-error" class="form-error-box" hidden></div>
      <button type="submit" id="submit-whatsapp-order-btn" class="btn btn-gold">
        ${
          pm === 'whatsapp_cod'
            ? 'تأكيد وإرسال الطلب عبر واتساب'
            : pm === 'stripe'
              ? 'الانتقال لبوابة الدفع Stripe'
              : `إتمام الدفع الآمن (${escapeHtml(formatPrice(subtotal, currency))})`
        }
      </button>
      <button type="button" id="cart-continue-btn" class="btn btn-secondary">
        متابعة التسوق
      </button>
    </form>
  `;

  footer.querySelectorAll('[data-pay-method]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.checkoutPaymentMethod = btn.getAttribute('data-pay-method') || 'online_card';
      renderCartDrawer();
    });
  });

  body.querySelectorAll('[data-cart-dec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cart-dec'));
      if (state.cart[idx].quantity > 1) {
        state.cart[idx].quantity -= 1;
      } else {
        state.cart.splice(idx, 1);
      }
      saveCartToStorage();
      updateCartBadge();
      renderCartDrawer();
    });
  });

  body.querySelectorAll('[data-cart-inc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cart-inc'));
      const max = state.cart[idx].maxStock || 99;
      if (state.cart[idx].quantity < max) {
        state.cart[idx].quantity += 1;
        saveCartToStorage();
        updateCartBadge();
        renderCartDrawer();
      } else {
        showToast('وصلت للحد الأقصى المتاح في المخزون.', 'error');
      }
    });
  });

  body.querySelectorAll('[data-cart-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cart-remove'));
      state.cart.splice(idx, 1);
      saveCartToStorage();
      updateCartBadge();
      renderCartDrawer();
    });
  });

  document.getElementById('cart-continue-btn')?.addEventListener('click', closeCartDrawer);

  document.getElementById('whatsapp-checkout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('checkout-error');
    const submitBtn = document.getElementById('submit-whatsapp-order-btn');
    const formData = new FormData(e.target);
    const activePm = state.checkoutPaymentMethod || 'online_card';

    const payload = {
      customerName: String(formData.get('customerName') || '').trim(),
      customerPhone: String(formData.get('customerPhone') || '').trim(),
      customerAddress: String(formData.get('customerAddress') || '').trim(),
      customerNotes: String(formData.get('customerNotes') || '').trim(),
      paymentMethod: activePm,
      items: state.cart.map((i) => ({
        productId: i.productId,
        size: i.size,
        color: i.color,
        quantity: i.quantity,
      })),
    };

    if (activePm === 'online_card') {
      payload.cardHolder = String(formData.get('cardHolder') || '').trim();
      payload.cardNumber = String(formData.get('cardNumber') || '').trim();
      payload.expiry = String(formData.get('expiry') || '').trim();
      payload.cvv = String(formData.get('cvv') || '').trim();
    } else if (activePm === 'online_wallet') {
      payload.walletPhone = String(formData.get('walletPhone') || '').trim();
    }

    if (errBox) errBox.hidden = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = activePm === 'whatsapp_cod' ? 'جارٍ تأكيد الطلب...' : 'جارٍ معالجة الدفع الآمن...';
    }

    try {
      if (activePm === 'whatsapp_cod') {
        const res = await apiFetch('/api/orders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        state.lastOrderReceipt = res;
        state.cart = [];
        saveCartToStorage();
        updateCartBadge();
        renderCartDrawer();
        showToast(`تم إنشاء الطلب رقم ${res.order.orderNumber} بنجاح.`);
        await refreshStorefrontData(false);
      } else {
        const res = await apiFetch('/api/payments/checkout', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.redirectUrl) {
          window.location.assign(res.redirectUrl);
          return;
        }
        state.lastOrderReceipt = res;
        state.cart = [];
        saveCartToStorage();
        updateCartBadge();
        renderCartDrawer();
        showToast(`تم الدفع وتأكيد الطلب ${res.order.orderNumber} بنجاح.`);
        await refreshStorefrontData(false);
      }
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message || 'يرجى التحقق من البيانات المدخلة.';
        errBox.hidden = false;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent =
          activePm === 'whatsapp_cod'
            ? 'تأكيد وإرسال الطلب عبر واتساب'
            : activePm === 'stripe'
              ? 'الانتقال لبوابة الدفع Stripe'
              : `إتمام الدفع الآمن (${formatPrice(subtotal, currency)})`;
      }
    }
  });
}

// ==========================================
// Customer Account, Google Sync, Orders & Wishlist
// ==========================================

function getGoogleLogoSvg() {
  return `
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.39 3.62v3.01h3.87c2.26-2.08 3.58-5.15 3.58-8.82z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3.01c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24z"/>
      <path fill="#FBBC05" d="M5.27 14.27A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.27v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.37l4-3.1z"/>
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.63l4 3.1C6.22 6.88 8.87 4.77 12 4.77z"/>
    </svg>
  `;
}

function setAccountDropdownOpen(open) {
  state.accountMenuOpen = Boolean(open);
  const btn = document.getElementById('open-account-btn');
  const menu = document.getElementById('account-menu-dropdown');
  if (btn) btn.setAttribute('aria-expanded', String(state.accountMenuOpen));
  if (menu) menu.hidden = !state.accountMenuOpen;
  if (state.accountMenuOpen) {
    renderAccountDropdownMenu();
  }
}

function renderAccountDropdownMenu() {
  const menu = document.getElementById('account-menu-dropdown');
  if (!menu) return;

  if (!state.customer) {
    menu.innerHTML = `
      <div style="display:grid;gap:0.2rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border-hairline);">
        <strong style="font-size:0.94rem;color:var(--navy-900);">قائمة حساب العميل</strong>
        <span style="font-size:0.78rem;color:var(--text-muted);">سجّل دخولك لمزامنة المفضلة والطلبات عبر أجهزتك.</span>
      </div>

      <button type="button" class="google-auth-btn" id="menu-google-login-btn" ${state.googleSyncBusy ? 'disabled' : ''}>
        ${getGoogleLogoSvg()}
        <span>${state.googleSyncBusy ? 'جارٍ المزامنة مع Google...' : 'المتابعة والمزامنة عبر Google'}</span>
      </button>

      <div class="auth-divider">أو</div>

      <button type="button" class="account-menu-item" id="menu-open-login-btn">
        <span>تسجيل الدخول بالبريد الإلكتروني</span>
        <span aria-hidden="true">←</span>
      </button>
      <button type="button" class="account-menu-item" id="menu-open-register-btn">
        <span>إنشاء حساب جديد</span>
        <span aria-hidden="true">←</span>
      </button>
    `;

    document.getElementById('menu-google-login-btn')?.addEventListener('click', handleGoogleCustomerSignIn);
    document.getElementById('menu-open-login-btn')?.addEventListener('click', () => {
      setAccountDropdownOpen(false);
      state.accountTab = 'login';
      openAccountModal();
    });
    document.getElementById('menu-open-register-btn')?.addEventListener('click', () => {
      setAccountDropdownOpen(false);
      state.accountTab = 'register';
      openAccountModal();
    });
    return;
  }

  const cust = state.customer;
  const isGoogle = cust.authProvider === 'google' || Boolean(cust.googleUid);
  const initial = escapeHtml((cust.name || 'O').trim().charAt(0).toUpperCase());

  menu.innerHTML = `
    <div class="account-menu-head">
      ${
        cust.photoUrl
          ? `<img src="${escapeHtml(cust.photoUrl)}" alt="${escapeHtml(cust.name)}" class="account-avatar-img" referrerpolicy="no-referrer" />`
          : `<span class="account-avatar-fallback" aria-hidden="true">${initial}</span>`
      }
      <div style="min-width:0;">
        <div style="font-weight:700;font-size:0.92rem;color:var(--navy-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(cust.name)}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(cust.email)}</div>
      </div>
    </div>

    ${
      isGoogle
        ? `<div class="sync-status-line"><span>✓</span><span>متصل ومزامن سحابياً عبر Google</span></div>`
        : `<button type="button" class="google-auth-btn" id="menu-google-link-btn" ${state.googleSyncBusy ? 'disabled' : ''}>
            ${getGoogleLogoSvg()}
            <span>${state.googleSyncBusy ? 'جارٍ الربط...' : 'ربط ومزامنة مع حساب Google'}</span>
          </button>`
    }

    <button type="button" class="account-menu-item" data-menu-acc-tab="profile">
      <span>الملف الشخصي والعنوان</span>
      <span aria-hidden="true">←</span>
    </button>
    <button type="button" class="account-menu-item" data-menu-acc-tab="wishlist">
      <span>قائمة المفضلة</span>
      <span class="tabular-nums">${state.wishlistIds.length}</span>
    </button>
    <button type="button" class="account-menu-item" data-menu-acc-tab="orders">
      <span>طلباتي السابقة</span>
      <span aria-hidden="true">←</span>
    </button>
    <button type="button" class="account-menu-item is-danger" id="menu-logout-btn">
      <span>تسجيل الخروج</span>
      <span aria-hidden="true">✕</span>
    </button>
  `;

  document.getElementById('menu-google-link-btn')?.addEventListener('click', handleGoogleCustomerSignIn);
  menu.querySelectorAll('[data-menu-acc-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.accountTab = btn.getAttribute('data-menu-acc-tab') || 'profile';
      setAccountDropdownOpen(false);
      openAccountModal();
    });
  });
  document.getElementById('menu-logout-btn')?.addEventListener('click', async () => {
    setAccountDropdownOpen(false);
    await performCustomerLogout();
  });
}

async function performCustomerLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearCustomerToken();
    await signOutFirebase();
    state.customer = null;
    state.wishlistIds = [];
    state.accountTab = 'login';
    updateAccountHeaderButton();
    renderStorefrontPage();
    const dialog = document.getElementById('account-dialog');
    if (dialog?.open) renderAccountModal();
    showToast('تم تسجيل الخروج بنجاح.');
  }
}

async function handleGoogleCustomerSignIn() {
  if (state.googleSyncBusy) return;
  state.googleSyncBusy = true;
  renderAccountDropdownMenu();
  const dialog = document.getElementById('account-dialog');
  if (dialog?.open) renderAccountModal();

  try {
    const { user, idToken } = await signInWithGooglePopup();

    let cloudProfile = null;
    try {
      cloudProfile = await readSyncedCloudProfile(user.uid);
    } catch {
      cloudProfile = null;
    }

    const cloudWishlist = Array.isArray(cloudProfile?.wishlistIds) ? cloudProfile.wishlistIds : [];
    const res = await apiFetch('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        idToken,
        syncWishlistIds: cloudWishlist,
      }),
    });

    if (res.token) setCustomerToken(res.token);
    state.customer = res.customer;
    state.wishlistIds = Array.isArray(res.wishlistIds) ? res.wishlistIds : [];

    // If Firestore had phone/address not yet saved in SQLite, sync them to SQLite
    if (
      cloudProfile &&
      ((cloudProfile.phone && !state.customer.phone) || (cloudProfile.address && !state.customer.address))
    ) {
      try {
        const updatedProf = await apiFetch('/api/account/profile', {
          method: 'PUT',
          body: JSON.stringify({
            phone: state.customer.phone || cloudProfile.phone || '',
            address: state.customer.address || cloudProfile.address || '',
          }),
        });
        if (updatedProf.customer) state.customer = updatedProf.customer;
      } catch {
        // non-blocking
      }
    }

    // Write back merged profile + wishlist to Firestore
    try {
      await upsertSyncedCloudProfile({
        user,
        name: state.customer.name,
        phone: state.customer.phone || cloudProfile?.phone || '',
        address: state.customer.address || cloudProfile?.address || '',
        wishlistIds: state.wishlistIds,
        authProvider: 'google',
      });
    } catch {
      // structured error already logged inside firebaseClient
    }

    state.accountTab = 'profile';
    setAccountDropdownOpen(false);
    updateAccountHeaderButton();
    renderStorefrontPage();
    if (dialog?.open) renderAccountModal();
    showToast(`تم تسجيل الدخول ومزامنة حساب ${state.customer.name} عبر Google بنجاح.`);
  } catch (err) {
    const code = err?.code || '';
    let msg = err?.message || 'تعذر تسجيل الدخول عبر Google.';
    if (code === 'auth/popup-closed-by-user') {
      msg = 'تم إغلاق نافذة تسجيل الدخول عبر Google قبل إتمام العملية.';
    } else if (code === 'auth/popup-blocked') {
      msg = 'قام المتصفح بحظر النافذة المنبثقة. يرجى السماح بالنوافذ المنبثقة والمحاولة مجدداً.';
    }
    const errBox = document.getElementById('cust-auth-error');
    if (errBox && dialog?.open) {
      errBox.textContent = msg;
      errBox.hidden = false;
    } else {
      showToast(msg, 'error');
    }
  } finally {
    state.googleSyncBusy = false;
    renderAccountDropdownMenu();
    if (dialog?.open) renderAccountModal();
  }
}

async function loadCurrentCustomer() {
  try {
    const res = await apiFetch('/api/auth/me');
    state.customer = res.authenticated ? res.customer : null;
    state.wishlistIds = Array.isArray(res.wishlistIds) ? res.wishlistIds : [];
    if (!res.authenticated) {
      clearCustomerToken();
    } else if (firebaseAuth.currentUser && state.customer?.googleUid) {
      readSyncedCloudProfile(firebaseAuth.currentUser.uid)
        .then(async (cloud) => {
          if (cloud && Array.isArray(cloud.wishlistIds) && cloud.wishlistIds.length) {
            const mergedRes = await apiFetch('/api/wishlist/sync', {
              method: 'POST',
              body: JSON.stringify({ productIds: cloud.wishlistIds }),
            });
            if (Array.isArray(mergedRes.wishlistIds)) {
              state.wishlistIds = mergedRes.wishlistIds;
              updateAccountHeaderButton();
              renderStorefrontPage();
            }
          }
        })
        .catch(() => {});
    }
  } catch {
    state.customer = null;
    state.wishlistIds = [];
  }
  updateAccountHeaderButton();
}

async function openAccountModal() {
  const dialog = document.getElementById('account-dialog');
  if (!dialog) return;
  setAccountDropdownOpen(false);
  if (!state.customer && state.accountTab !== 'login' && state.accountTab !== 'register') {
    state.accountTab = 'login';
  }
  if (state.customer && (state.accountTab === 'login' || state.accountTab === 'register')) {
    state.accountTab = 'profile';
  }
  if (state.customer && state.accountTab === 'orders') {
    try {
      const res = await apiFetch('/api/account/orders');
      state.accountOrders = res.orders || [];
    } catch {
      state.accountOrders = [];
    }
  }
  renderAccountModal();
  if (!dialog.open) dialog.showModal();
}

function renderAccountModal() {
  const dialog = document.getElementById('account-dialog');
  const content = document.getElementById('account-dialog-content');
  if (!dialog || !content) return;

  const currency = state.storefront?.settings?.currencySymbol || 'ج.م';

  if (!state.customer) {
    const isReg = state.accountTab === 'register';
    content.innerHTML = `
      <div class="pdp-topbar">
        <h2 id="account-dialog-title" style="margin:0;font-size:1.25rem;color:var(--navy-900);">حساب عملاء ORVA 7</h2>
        <button type="button" id="close-account-btn" class="icon-btn" aria-label="إغلاق نافذة الحساب">✕</button>
      </div>

      <div style="display:grid;gap:0.65rem;margin-bottom:1rem;">
        <button type="button" class="google-auth-btn" id="modal-google-login-btn" ${state.googleSyncBusy ? 'disabled' : ''}>
          ${getGoogleLogoSvg()}
          <span>${state.googleSyncBusy ? 'جارٍ الاتصال والمزامنة مع Google...' : 'المتابعة والمزامنة عبر حساب Google'}</span>
        </button>
        <div class="auth-divider">أو عبر البريد الإلكتروني</div>
      </div>

      <div class="account-tabs">
        <button type="button" class="account-tab-btn ${!isReg ? 'is-active' : ''}" data-acc-tab="login">تسجيل الدخول</button>
        <button type="button" class="account-tab-btn ${isReg ? 'is-active' : ''}" data-acc-tab="register">إنشاء حساب جديد</button>
      </div>

      ${
        !isReg
          ? `
        <form id="customer-login-form" class="checkout-form" novalidate>
          <div class="field-group">
            <label for="cust-login-email">البريد الإلكتروني *</label>
            <input id="cust-login-email" name="email" type="email" class="field-input" required placeholder="name@example.com" />
          </div>
          <div class="field-group">
            <label for="cust-login-pass">كلمة المرور *</label>
            <input id="cust-login-pass" name="password" type="password" class="field-input" required placeholder="••••••" />
          </div>
          <div id="cust-auth-error" class="form-error-box" hidden></div>
          <button type="submit" class="btn btn-primary">دخول إلى حسابي</button>
        </form>
      `
          : `
        <form id="customer-register-form" class="checkout-form" novalidate>
          <div class="account-form-grid">
            <div class="field-group">
              <label for="cust-reg-name">الاسم الكامل *</label>
              <input id="cust-reg-name" name="name" type="text" class="field-input" required placeholder="سارة محمود" />
            </div>
            <div class="field-group">
              <label for="cust-reg-phone">رقم الهاتف *</label>
              <input id="cust-reg-phone" name="phone" type="tel" class="field-input" required placeholder="010XXXXXXXX" />
            </div>
            <div class="field-group">
              <label for="cust-reg-email">البريد الإلكتروني *</label>
              <input id="cust-reg-email" name="email" type="email" class="field-input" required placeholder="name@example.com" />
            </div>
            <div class="field-group">
              <label for="cust-reg-pass">كلمة المرور (6 أحرف فأكثر) *</label>
              <input id="cust-reg-pass" name="password" type="password" minlength="6" class="field-input" required placeholder="••••••" />
            </div>
          </div>
          <div class="field-group">
            <label for="cust-reg-addr">عنوان التوصيل (اختياري)</label>
            <input id="cust-reg-addr" name="address" type="text" class="field-input" placeholder="المدينة - الحي - الشارع" />
          </div>
          <div id="cust-auth-error" class="form-error-box" hidden></div>
          <button type="submit" class="btn btn-gold">إنشاء الحساب والمتابعة</button>
        </form>
      `
      }
    `;

    document.getElementById('close-account-btn')?.addEventListener('click', () => dialog.close());
    document.getElementById('modal-google-login-btn')?.addEventListener('click', handleGoogleCustomerSignIn);
    content.querySelectorAll('[data-acc-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.accountTab = btn.getAttribute('data-acc-tab') || 'login';
        renderAccountModal();
      });
    });

    document.getElementById('customer-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('cust-auth-error');
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: String(fd.get('email') || '').trim(),
            password: String(fd.get('password') || ''),
          }),
        });
        if (res.token) setCustomerToken(res.token);
        state.customer = res.customer;
        state.wishlistIds = res.wishlistIds || [];
        state.accountTab = 'profile';
        updateAccountHeaderButton();
        renderStorefrontPage();
        renderAccountModal();
        showToast(`مرحباً بك، ${res.customer.name}`);
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message || 'فشل تسجيل الدخول.';
          errBox.hidden = false;
        }
      }
    });

    document.getElementById('customer-register-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('cust-auth-error');
      const fd = new FormData(e.target);
      try {
        const res = await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: String(fd.get('name') || '').trim(),
            phone: String(fd.get('phone') || '').trim(),
            email: String(fd.get('email') || '').trim(),
            address: String(fd.get('address') || '').trim(),
            password: String(fd.get('password') || ''),
          }),
        });
        if (res.token) setCustomerToken(res.token);
        state.customer = res.customer;
        state.wishlistIds = res.wishlistIds || [];
        state.accountTab = 'profile';
        updateAccountHeaderButton();
        renderStorefrontPage();
        renderAccountModal();
        showToast('تم إنشاء حسابك في ORVA 7 بنجاح.');
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message || 'تعذر إنشاء الحساب.';
          errBox.hidden = false;
        }
      }
    });
    return;
  }

  const cust = state.customer;
  const tab = state.accountTab || 'profile';
  const wishProducts = (state.storefront?.products || []).filter((p) => state.wishlistIds.includes(p.id));
  const isGoogle = cust.authProvider === 'google' || Boolean(cust.googleUid);

  content.innerHTML = `
    <div class="pdp-topbar">
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${
          cust.photoUrl
            ? `<img src="${escapeHtml(cust.photoUrl)}" alt="${escapeHtml(cust.name)}" class="account-avatar-img" referrerpolicy="no-referrer" />`
            : `<span class="account-avatar-fallback" aria-hidden="true">${escapeHtml((cust.name || 'O').charAt(0).toUpperCase())}</span>`
        }
        <div>
          <h2 id="account-dialog-title" style="margin:0;font-size:1.2rem;color:var(--navy-900);">أهلاً، ${escapeHtml(cust.name)}</h2>
          <span style="font-size:0.82rem;color:var(--text-muted);">${escapeHtml(cust.email)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <button type="button" id="cust-logout-btn" class="btn btn-secondary btn-sm">تسجيل الخروج</button>
        <button type="button" id="close-account-btn" class="icon-btn" aria-label="إغلاق نافذة الحساب">✕</button>
      </div>
    </div>

    <div class="account-tabs">
      <button type="button" class="account-tab-btn ${tab === 'profile' ? 'is-active' : ''}" data-acc-tab="profile">الملف الشخصي</button>
      <button type="button" class="account-tab-btn ${tab === 'wishlist' ? 'is-active' : ''}" data-acc-tab="wishlist">قائمة المفضلة (${wishProducts.length})</button>
      <button type="button" class="account-tab-btn ${tab === 'orders' ? 'is-active' : ''}" data-acc-tab="orders">طلباتي السابقة</button>
    </div>

    ${
      tab === 'profile'
        ? `
      <div style="margin-bottom:1rem;">
        ${
          isGoogle
            ? `<div class="sync-status-line"><span>✓</span><span>حسابك مرتبط ومزامن تلقائياً مع Google (البيانات والمفضلة محفوظة سحابياً)</span></div>`
            : `<button type="button" class="google-auth-btn" id="profile-google-link-btn" ${state.googleSyncBusy ? 'disabled' : ''}>
                ${getGoogleLogoSvg()}
                <span>${state.googleSyncBusy ? 'جارٍ الربط...' : 'ربط ومزامنة هذا الحساب مع Google'}</span>
              </button>`
        }
      </div>

      <form id="cust-profile-form" class="checkout-form" style="margin-bottom:1.25rem;" novalidate>
        <div class="account-form-grid">
          <div class="field-group">
            <label for="prof-name">الاسم الكامل</label>
            <input id="prof-name" name="name" type="text" class="field-input" required value="${escapeHtml(cust.name)}" />
          </div>
          <div class="field-group">
            <label for="prof-phone">رقم الهاتف</label>
            <input id="prof-phone" name="phone" type="tel" class="field-input" placeholder="010XXXXXXXX" value="${escapeHtml(cust.phone || '')}" />
          </div>
        </div>
        <div class="field-group">
          <label for="prof-addr">عنوان التوصيل الافتراضي</label>
          <input id="prof-addr" name="address" type="text" class="field-input" placeholder="المدينة - الحي - الشارع" value="${escapeHtml(cust.address || '')}" />
        </div>
        <div>
          <button type="submit" class="btn btn-primary btn-sm">حفظ ومزامنة بيانات الحساب</button>
        </div>
      </form>

      ${
        !isGoogle
          ? `
        <form id="cust-pass-form" class="review-form-card" novalidate>
          <h4 style="margin:0;font-size:0.94rem;color:var(--navy-900);">تغيير كلمة المرور</h4>
          <div class="account-form-grid">
            <div class="field-group">
              <label for="prof-cur-pw">كلمة المرور الحالية</label>
              <input id="prof-cur-pw" name="currentPassword" type="password" class="field-input" required />
            </div>
            <div class="field-group">
              <label for="prof-new-pw">كلمة المرور الجديدة (6 أحرف فأكثر)</label>
              <input id="prof-new-pw" name="newPassword" type="password" minlength="6" class="field-input" required />
            </div>
          </div>
          <div><button type="submit" class="btn btn-secondary btn-sm">تحديث كلمة المرور</button></div>
        </form>
      `
          : ''
      }
    `
        : tab === 'wishlist'
          ? `
      ${
        wishProducts.length
          ? `<div class="wishlist-grid">
              ${wishProducts
                .map(
                  (wp) => `
                <div class="wishlist-mini-card">
                  ${renderImageWithFallback(wp.images[0] || '', wp.name)}
                  <div style="display:grid;gap:0.35rem;">
                    <strong style="font-size:0.92rem;color:var(--navy-900);">${escapeHtml(wp.name)}</strong>
                    <span class="tabular-nums" style="font-size:0.86rem;font-weight:700;">${escapeHtml(formatPrice(wp.pricing?.finalPrice ?? wp.price, currency))}</span>
                    <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                      <button type="button" class="btn btn-primary btn-sm" data-wish-open="${escapeHtml(wp.id)}">عرض القطعة</button>
                      <button type="button" class="btn btn-danger btn-sm" data-wish-remove="${escapeHtml(wp.id)}">إزالة</button>
                    </div>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>`
          : `<div class="empty-state"><h3>قائمة المفضلة فارغة</h3><p>اضغط على أيقونة القلب ♡ في أي قطعة لحفظها هنا ومزامنتها مع حسابك.</p></div>`
      }
    `
          : `
      ${
        state.accountOrders.length
          ? `<div class="account-orders-list">
              ${state.accountOrders
                .map((ord) => {
                  const st = ORDER_STATUS_META[ord.status] || { label: ord.status, cls: 'status-muted' };
                  const pm = PAYMENT_STATUS_META[ord.paymentStatus] || { label: ord.paymentStatus || 'غير مدفوع', cls: 'status-muted' };
                  return `
                  <div class="account-order-card">
                    <div class="account-order-head">
                      <strong class="tabular-nums">${escapeHtml(ord.orderNumber)}</strong>
                      <div style="display:flex;gap:0.5rem;align-items:center;font-size:0.82rem;">
                        <span class="status-label ${pm.cls}">${pm.label}</span>
                        <span>·</span>
                        <span class="status-label ${st.cls}">${st.label}</span>
                      </div>
                    </div>
                    <div style="font-size:0.84rem;color:var(--text-secondary);">
                      ${ord.items.map((it) => `${escapeHtml(it.productName)} (${escapeHtml(it.size)} × ${it.quantity})`).join('، ')}
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.84rem;color:var(--text-muted);">
                      <span>${escapeHtml(formatDateAr(ord.createdAt))} · ${escapeHtml(PAYMENT_METHOD_LABELS[ord.paymentMethod] || ord.paymentMethod)}</span>
                      <strong class="tabular-nums" style="color:var(--navy-900);">${escapeHtml(formatPrice(ord.totalPrice, currency))}</strong>
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>`
          : `<div class="empty-state"><h3>لا توجد طلبات مسجلة لحسابك بعد</h3><p>عند إتمام طلبك الأول سيظهر هنا مع إمكانية متابعة الدفع والتوصيل وتقييم القطع.</p></div>`
      }
    `
    }
  `;

  document.getElementById('close-account-btn')?.addEventListener('click', () => dialog.close());
  document.getElementById('cust-logout-btn')?.addEventListener('click', performCustomerLogout);
  document.getElementById('profile-google-link-btn')?.addEventListener('click', handleGoogleCustomerSignIn);

  content.querySelectorAll('[data-acc-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.accountTab = btn.getAttribute('data-acc-tab') || 'profile';
      if (state.accountTab === 'orders') {
        try {
          const res = await apiFetch('/api/account/orders');
          state.accountOrders = res.orders || [];
        } catch {
          state.accountOrders = [];
        }
      }
      renderAccountModal();
    });
  });

  document.getElementById('cust-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await apiFetch('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: String(fd.get('name') || '').trim(),
          phone: String(fd.get('phone') || '').trim(),
          address: String(fd.get('address') || '').trim(),
        }),
      });
      state.customer = res.customer;
      if (firebaseAuth.currentUser && state.customer?.googleUid) {
        upsertSyncedCloudProfile({
          user: firebaseAuth.currentUser,
          name: state.customer.name,
          phone: state.customer.phone || '',
          address: state.customer.address || '',
          wishlistIds: state.wishlistIds,
          authProvider: 'google',
        }).catch(() => {});
      }
      updateAccountHeaderButton();
      renderAccountModal();
      showToast('تم تحديث ومزامنة بيانات حسابك.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('cust-pass-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/account/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: String(fd.get('currentPassword') || ''),
          newPassword: String(fd.get('newPassword') || ''),
        }),
      });
      e.target.reset();
      showToast('تم تحديث كلمة المرور بنجاح.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  content.querySelectorAll('[data-wish-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-wish-open');
      dialog.close();
      if (pid) openProductDetail(pid);
    });
  });

  content.querySelectorAll('[data-wish-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.getAttribute('data-wish-remove');
      if (pid) {
        await toggleWishlistItem(pid);
        renderAccountModal();
      }
    });
  });
}

// ==========================================
// Floating AI Customer Service Assistant
// ==========================================

function ensureWelcomeChatMessage() {
  if (state.aiChat.messages.length === 0) {
    state.aiChat.messages.push({
      role: 'model',
      text: 'أهلاً بك في دار ORVA 7! أنا مستشارك الذكي لخدمة العملاء. أقدر أساعدك في اختيار القطع المناسبة، المقاسات، الأسعار والعروض الحالية، أو تفاصيل الشحن والطلب عبر واتساب. تحب تسأل عن إيه النهارده؟',
    });
  }
}

function formatAiMessageHtml(text) {
  const escaped = escapeHtml(text || '');
  return escaped.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

function renderAiChatMessages() {
  const list = document.getElementById('ai-chat-messages');
  const typing = document.getElementById('ai-chat-typing');
  if (!list) return;

  ensureWelcomeChatMessage();
  if (typing) typing.hidden = !state.aiChat.isSending;

  const showQuickPrompts = state.aiChat.messages.length === 1 && !state.aiChat.isSending;

  list.innerHTML = `
    ${state.aiChat.messages
      .map((m) => {
        const cls =
          m.role === 'user' ? 'ai-msg ai-msg-user' : m.role === 'error' ? 'ai-msg ai-msg-error' : 'ai-msg ai-msg-model';
        return `<div class="${cls}">${formatAiMessageHtml(m.text)}</div>`;
      })
      .join('')}
    ${
      showQuickPrompts
        ? `
      <div class="ai-quick-prompts">
        <button type="button" class="ai-quick-btn" data-ai-prompt="إيه أحدث المعاطف والبليزر المتوفرة وأسعارها؟">المعاطف والأسعار</button>
        <button type="button" class="ai-quick-btn" data-ai-prompt="في عروض أو خصومات شغالة دلوقتي؟">العروض الحالية</button>
        <button type="button" class="ai-quick-btn" data-ai-prompt="مواعيد الشحن وسياسة الاسترجاع إيه؟">الشحن والاسترجاع</button>
      </div>
    `
        : ''
    }
  `;

  list.querySelectorAll('[data-ai-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-ai-prompt');
      if (prompt) sendAiChatMessage(prompt);
    });
  });

  list.scrollTop = list.scrollHeight;
}

async function sendAiChatMessage(text) {
  const clean = String(text || '').trim();
  if (!clean || state.aiChat.isSending) return;

  ensureWelcomeChatMessage();
  state.aiChat.messages.push({ role: 'user', text: clean });
  state.aiChat.isSending = true;
  renderAiChatMessages();

  const sendBtn = document.getElementById('ai-chat-send');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await apiFetch('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: clean,
        history: state.aiChat.history,
      }),
    });
    const reply = res.reply || '';
    state.aiChat.history.push({ role: 'user', text: clean });
    state.aiChat.history.push({ role: 'model', text: reply });
    state.aiChat.messages.push({ role: 'model', text: reply });
  } catch (err) {
    const waNumber = state.storefront?.settings?.whatsappNumber || '+201098416124';
    state.aiChat.messages.push({
      role: 'error',
      text: `${err.message || 'تعذر الاتصال بالمساعد الذكي حالياً.'}\nللمساعدة الفورية تواصل معنا عبر واتساب: \u2066${waNumber}\u2069`,
    });
  } finally {
    state.aiChat.isSending = false;
    if (sendBtn) sendBtn.disabled = false;
    renderAiChatMessages();
  }
}

function toggleAiChatWindow(forceState = null) {
  const win = document.getElementById('ai-chat-window');
  const fab = document.getElementById('ai-chat-fab');
  if (!win || !fab) return;
  const nextOpen = forceState !== null ? Boolean(forceState) : win.hidden;
  state.aiChat.isOpen = nextOpen;
  win.hidden = !nextOpen;
  fab.setAttribute('aria-expanded', String(nextOpen));
  if (nextOpen) {
    renderAiChatMessages();
    document.getElementById('ai-chat-input')?.focus();
  }
}

async function handleStripeReturnIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('stripe_session_id');
  const orderId = params.get('order_id');
  const cancelled = params.get('stripe_cancelled');

  if (sessionId && orderId) {
    try {
      const res = await apiFetch('/api/payments/stripe/verify', {
        method: 'POST',
        body: JSON.stringify({ sessionId, orderId }),
      });
      if (res.paid) {
        state.lastOrderReceipt = res;
        state.cart = [];
        saveCartToStorage();
        updateCartBadge();
        openCartDrawer();
        showToast(`تم تأكيد الدفع الإلكتروني للطلب ${res.order.orderNumber}.`);
      }
    } catch (err) {
      showToast(err.message || 'تعذر التحقق من عملية الدفع.', 'error');
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (cancelled) {
    showToast('تم إلغاء عملية الدفع عبر Stripe، يمكنك المحاولة مرة أخرى.', 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

async function refreshStorefrontData(renderPage = true) {
  const data = await apiFetch('/api/storefront');
  state.storefront = data;
  state.filteredProducts = data.products || [];
  renderHeaderAndFooter();
  if (renderPage) {
    renderStorefrontPage();
  }
}

async function initStorefront() {
  updateCartBadge();

  document.getElementById('close-announcement-btn')?.addEventListener('click', () => {
    const bar = document.getElementById('announcement-bar');
    if (bar) bar.hidden = true;
  });

  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const mobileDrawer = document.getElementById('mobile-nav-drawer');
  mobileToggle?.addEventListener('click', () => {
    const isHidden = mobileDrawer.hidden;
    mobileDrawer.hidden = !isHidden;
    mobileToggle.setAttribute('aria-expanded', String(isHidden));
  });
  mobileDrawer?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileDrawer.hidden = true;
      mobileToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  document.getElementById('open-account-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setAccountDropdownOpen(!state.accountMenuOpen);
  });

  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('account-menu-wrap');
    if (state.accountMenuOpen && wrap && !wrap.contains(e.target)) {
      setAccountDropdownOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.accountMenuOpen) {
      setAccountDropdownOpen(false);
    }
  });

  document.getElementById('mobile-account-btn')?.addEventListener('click', () => {
    if (mobileDrawer) mobileDrawer.hidden = true;
    mobileToggle?.setAttribute('aria-expanded', 'false');
    openAccountModal();
  });

  document.getElementById('mobile-ai-btn')?.addEventListener('click', () => {
    if (mobileDrawer) mobileDrawer.hidden = true;
    mobileToggle?.setAttribute('aria-expanded', 'false');
    toggleAiChatWindow(true);
  });

  document.getElementById('open-cart-btn')?.addEventListener('click', openCartDrawer);
  document.getElementById('close-cart-btn')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cart-backdrop')?.addEventListener('click', closeCartDrawer);

  document.getElementById('ai-chat-fab')?.addEventListener('click', () => toggleAiChatWindow());
  document.getElementById('ai-chat-close')?.addEventListener('click', () => toggleAiChatWindow(false));
  document.getElementById('ai-chat-reset')?.addEventListener('click', () => {
    state.aiChat.messages = [];
    state.aiChat.history = [];
    renderAiChatMessages();
  });
  document.getElementById('ai-chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('ai-chat-input');
    const val = input?.value || '';
    if (!val.trim()) return;
    input.value = '';
    sendAiChatMessage(val);
  });

  try {
    await loadCurrentCustomer();
    await refreshStorefrontData(true);
    await handleStripeReturnIfPresent();
  } catch (err) {
    const main = document.getElementById('storefront-main');
    if (main) {
      main.innerHTML = `
        <div class="container" style="padding-block:4rem;">
          <div class="empty-state">
            <h3>تعذر تحميل بيانات المتجر</h3>
            <p>${escapeHtml(err.message)}</p>
            <button type="button" class="btn btn-primary" onclick="location.reload()">إعادة المحاولة</button>
          </div>
        </div>
      `;
    }
  }
}

initStorefront();
