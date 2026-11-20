import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import {
  addWishlistItem,
  createCategory,
  createCollection,
  createCustomer,
  createOffer,
  createOrderRecord,
  createProduct,
  deleteCategory,
  deleteCollection,
  deleteOffer,
  deleteProduct,
  findOrCreateGoogleCustomer,
  getAdminUser,
  getCustomerAuthByEmail,
  getCustomerById,
  getCustomerPasswordHash,
  getHomepageConfig,
  getOrderById,
  getProductByIdOrSlug,
  getReviewSummariesMap,
  getStoreSettings,
  getWishlistProductIds,
  isTokenRevoked,
  listCategories,
  listCollections,
  listOffers,
  listOrders,
  listOrdersByCustomer,
  listProductReviews,
  listProducts,
  mergeWishlistItems,
  removeWishlistItem,
  revokeToken,
  updateAdminPassword,
  updateCategory,
  updateCollection,
  updateCustomerPassword,
  updateCustomerProfile,
  updateHomepageConfig,
  updateOffer,
  updateOrderPayment,
  updateOrderStatus,
  updateProduct,
  updateStoreSettings,
  upsertProductReview,
  UPLOADS_DIR,
} from './server/db.ts';
import {
  buildWhatsAppOrderMessage,
  computeEffectivePricing,
  computeReviewSummary,
  filterAndSortProducts,
  findEligibleOrderForReview,
  hashPassword,
  isOfferActive,
  signCustomerToken,
  signSessionToken,
  validateCardPaymentInput,
  validateOrderPayload,
  validateReviewInput,
  verifyCustomerToken,
  verifyPassword,
  verifySessionToken,
} from './server/logic.ts';
import { generateOrvaAssistantReply } from './server/ai.ts';
import type {
  HomepageConfig,
  OrderStatus,
  PaymentStatus,
  ProductQuery,
  StoreSettings,
} from './server/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'orva_admin_session';
const CUSTOMER_COOKIE = 'orva_customer_session';

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key === 'MY_STRIPE_SECRET_KEY' || !key.startsWith('sk_')) {
    return null;
  }
  return new Stripe(key);
}

function getSessionSecret(): string {
  if (process.env.ORVA_SESSION_SECRET && process.env.ORVA_SESSION_SECRET !== 'SET_RANDOM_SESSION_SECRET') {
    return process.env.ORVA_SESSION_SECRET;
  }
  const secretFile = path.resolve(process.cwd(), 'data', '.session-secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

const SESSION_SECRET = getSessionSecret();

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function isSecureRequest(req: Request): boolean {
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  const referer = String(req.headers.referer || '').toLowerCase();
  return (
    req.secure ||
    fwdProto.includes('https') ||
    origin.startsWith('https://') ||
    referer.startsWith('https://')
  );
}

function buildSessionCookieHeader(
  name: string,
  value: string,
  maxAgeSeconds: number,
  req: Request
): string {
  const encoded = value ? encodeURIComponent(value) : '';
  const secure = isSecureRequest(req);
  const sameSite = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  return `${name}=${encoded}; Path=/; HttpOnly; ${sameSite}; Max-Age=${maxAgeSeconds}`;
}

function getFirebaseWebApiKey(): string | null {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
    return raw?.apiKey ? String(raw.apiKey).trim() : null;
  } catch {
    return null;
  }
}

interface AuthedRequest extends Request {
  adminUser?: { username: string; jti: string };
  customerUser?: { customerId: string; email: string; jti: string };
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req);
  const token = extractBearerToken(req) || cookies[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'يجب تسجيل الدخول للوصول إلى لوحة التحكم.' });
    return;
  }
  const verified = verifySessionToken(token, SESSION_SECRET);
  if (!verified || isTokenRevoked(verified.jti)) {
    res.status(401).json({ error: 'انتهت الجلسة أو بيانات الدخول غير صالحة.' });
    return;
  }
  req.adminUser = { username: verified.username, jti: verified.jti };
  next();
}

function getOptionalCustomer(req: Request): { customerId: string; email: string; jti: string } | null {
  const cookies = parseCookies(req);
  const token = extractBearerToken(req) || cookies[CUSTOMER_COOKIE];
  if (!token) return null;
  const verified = verifyCustomerToken(token, SESSION_SECRET);
  if (!verified || isTokenRevoked(verified.jti)) return null;
  return { customerId: verified.customerId, email: verified.email, jti: verified.jti };
}

function requireCustomer(req: AuthedRequest, res: Response, next: NextFunction): void {
  const verified = getOptionalCustomer(req);
  if (!verified) {
    res.status(401).json({ error: 'يجب تسجيل الدخول إلى حسابك أولاً.' });
    return;
  }
  req.customerUser = verified;
  next();
}

const VALID_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'completed',
  'cancelled',
];

const VALID_PAYMENT_STATUSES: PaymentStatus[] = [
  'unpaid',
  'pending',
  'paid',
  'failed',
  'refunded',
];

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

  // ==========================================
  // Public Storefront API
  // ==========================================

  app.get('/api/storefront', (_req, res) => {
    const settings = getStoreSettings();
    const homepage = getHomepageConfig();
    const categories = listCategories(true);
    const collections = listCollections(true);
    const nowMs = Date.now();
    const activeOffers = listOffers().filter((o) => isOfferActive(o, nowMs));
    const publishedProducts = listProducts(true);
    const reviewSummaries = getReviewSummariesMap();

    const enrichedProducts = publishedProducts.map((p) => ({
      ...p,
      pricing: computeEffectivePricing(p, activeOffers, nowMs),
      reviewSummary: reviewSummaries.get(p.id) || { averageRating: 0, reviewCount: 0 },
    }));

    const sizeSet = new Set<string>();
    const colorMap = new Map<string, string>();
    let minPrice = Infinity;
    let maxPrice = 0;

    for (const p of enrichedProducts) {
      p.sizes.forEach((s) => sizeSet.add(s));
      p.colors.forEach((c) => {
        if (!colorMap.has(c.name)) colorMap.set(c.name, c.hex);
      });
      if (p.pricing.finalPrice < minPrice) minPrice = p.pricing.finalPrice;
      if (p.pricing.finalPrice > maxPrice) maxPrice = p.pricing.finalPrice;
    }

    res.json({
      settings,
      homepage,
      categories,
      collections,
      activeOffers,
      products: enrichedProducts,
      stripeEnabled: Boolean(getStripeClient()),
      facets: {
        sizes: Array.from(sizeSet),
        colors: Array.from(colorMap.entries()).map(([name, hex]) => ({ name, hex })),
        minPrice: minPrice === Infinity ? 0 : minPrice,
        maxPrice,
      },
    });
  });

  app.get('/api/products', (req, res) => {
    const q = req.query;
    const query: ProductQuery = {
      search: typeof q.search === 'string' ? q.search : undefined,
      categoryId: typeof q.categoryId === 'string' && q.categoryId ? q.categoryId : undefined,
      collectionId: typeof q.collectionId === 'string' && q.collectionId ? q.collectionId : undefined,
      size: typeof q.size === 'string' && q.size ? q.size : undefined,
      color: typeof q.color === 'string' && q.color ? q.color : undefined,
      minPrice: q.minPrice !== undefined && q.minPrice !== '' ? Number(q.minPrice) : undefined,
      maxPrice: q.maxPrice !== undefined && q.maxPrice !== '' ? Number(q.maxPrice) : undefined,
      onSaleOnly: q.onSaleOnly === 'true',
      newArrivalOnly: q.newArrivalOnly === 'true',
      bestSellerOnly: q.bestSellerOnly === 'true',
      featuredOnly: q.featuredOnly === 'true',
      sort: (typeof q.sort === 'string' ? q.sort : 'featured') as ProductQuery['sort'],
    };

    const nowMs = Date.now();
    const activeOffers = listOffers().filter((o) => isOfferActive(o, nowMs));
    const reviewSummaries = getReviewSummariesMap();
    const products = filterAndSortProducts(
      listProducts(true),
      query,
      activeOffers,
      listCategories(true),
      listCollections(true),
      nowMs
    ).map((p) => ({
      ...p,
      reviewSummary: reviewSummaries.get(p.id) || { averageRating: 0, reviewCount: 0 },
    }));

    res.json({ products });
  });

  app.get('/api/products/:idOrSlug', (req, res) => {
    const product = getProductByIdOrSlug(req.params.idOrSlug);
    if (!product || !product.isPublished) {
      res.status(404).json({ error: 'المنتج غير موجود.' });
      return;
    }
    const nowMs = Date.now();
    const activeOffers = listOffers().filter((o) => isOfferActive(o, nowMs));
    const reviews = listProductReviews(product.id);
    const reviewSummary = computeReviewSummary(reviews);
    const reviewSummaries = getReviewSummariesMap();

    let canReview = false;
    const custAuth = getOptionalCustomer(req);
    if (custAuth) {
      const cust = getCustomerById(custAuth.customerId);
      if (cust) {
        const custOrders = listOrdersByCustomer(cust.id, cust.phone);
        canReview = Boolean(
          findEligibleOrderForReview(cust.id, cust.phone, product.id, custOrders)
        );
      }
    }

    const enriched = {
      ...product,
      pricing: computeEffectivePricing(product, activeOffers, nowMs),
      reviewSummary,
    };

    const related = listProducts(true)
      .filter((p) => p.id !== product.id && (p.categoryId === product.categoryId || p.isFeatured))
      .slice(0, 4)
      .map((p) => ({
        ...p,
        pricing: computeEffectivePricing(p, activeOffers, nowMs),
        reviewSummary: reviewSummaries.get(p.id) || { averageRating: 0, reviewCount: 0 },
      }));

    res.json({ product: enriched, related, reviews, canReview });
  });

  app.post('/api/products/:id/reviews', requireCustomer, (req: AuthedRequest, res) => {
    const product = getProductByIdOrSlug(req.params.id);
    if (!product || !product.isPublished) {
      res.status(404).json({ error: 'المنتج غير موجود.' });
      return;
    }
    const cust = getCustomerById(req.customerUser!.customerId);
    if (!cust) {
      res.status(401).json({ error: 'حساب العميل غير موجود.' });
      return;
    }
    const custOrders = listOrdersByCustomer(cust.id, cust.phone);
    const eligibleOrder = findEligibleOrderForReview(cust.id, cust.phone, product.id, custOrders);
    if (!eligibleOrder) {
      res.status(403).json({
        error: 'يمكنك تقييم هذا المنتج بعد إتمام شرائه من حسابك فقط.',
      });
      return;
    }
    const body = (req.body || {}) as { rating?: number; title?: string; comment?: string };
    const validated = validateReviewInput(body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    const review = upsertProductReview({
      productId: product.id,
      customerId: cust.id,
      customerName: cust.name,
      orderId: eligibleOrder.id,
      rating: validated.rating,
      title: validated.title,
      comment: validated.comment,
    });
    const reviews = listProductReviews(product.id);
    const reviewSummary = computeReviewSummary(reviews);
    res.status(201).json({ review, reviews, reviewSummary });
  });

  // ==========================================
  // Customer Authentication, Account & Wishlist
  // ==========================================

  app.post('/api/auth/register', (req, res) => {
    const body = (req.body || {}) as {
      name?: string;
      email?: string;
      phone?: string;
      address?: string;
      password?: string;
    };
    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const phone = (body.phone || '').trim();
    const address = (body.address || '').trim();
    const password = body.password || '';

    if (name.length < 2) {
      res.status(400).json({ error: 'يرجى إدخال الاسم الكامل بشكل صحيح.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صالح.' });
      return;
    }
    if (phone.replace(/[^\d+]/g, '').length < 8) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف صحيح.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' });
      return;
    }
    if (getCustomerAuthByEmail(email)) {
      res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل بالفعل.' });
      return;
    }

    const profile = createCustomer({
      name,
      email,
      phone,
      address,
      passwordHash: hashPassword(password),
    });

    const jti = crypto.randomUUID();
    const exp = Date.now() + 1000 * 60 * 60 * 24 * 7;
    const token = signCustomerToken(
      { customerId: profile.id, email: profile.email, exp, jti },
      SESSION_SECRET
    );
    res.setHeader(
      'Set-Cookie',
      buildSessionCookieHeader(CUSTOMER_COOKIE, token, 7 * 24 * 3600, req)
    );
    res.status(201).json({ authenticated: true, customer: profile, wishlistIds: [], token });
  });

  app.post('/api/auth/login', (req, res) => {
    const body = (req.body || {}) as { email?: string; password?: string };
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    if (!email || !password) {
      res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' });
      return;
    }
    const found = getCustomerAuthByEmail(email);
    if (!found || !verifyPassword(password, found.passwordHash)) {
      res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
      return;
    }

    const jti = crypto.randomUUID();
    const exp = Date.now() + 1000 * 60 * 60 * 24 * 7;
    const token = signCustomerToken(
      { customerId: found.profile.id, email: found.profile.email, exp, jti },
      SESSION_SECRET
    );
    res.setHeader(
      'Set-Cookie',
      buildSessionCookieHeader(CUSTOMER_COOKIE, token, 7 * 24 * 3600, req)
    );
    res.json({
      authenticated: true,
      customer: found.profile,
      wishlistIds: getWishlistProductIds(found.profile.id),
      token,
    });
  });

  app.post('/api/auth/google', async (req, res) => {
    const body = (req.body || {}) as { idToken?: string; syncWishlistIds?: string[] };
    const idToken = (body.idToken || '').trim();
    if (!idToken) {
      res.status(400).json({ error: 'رمز التحقق من Google مفقود.' });
      return;
    }

    const apiKey = getFirebaseWebApiKey();
    if (!apiKey) {
      res.status(503).json({ error: 'إعدادات Firebase غير متوفرة على الخادم حالياً.' });
      return;
    }

    try {
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );

      if (!lookupRes.ok) {
        res.status(401).json({ error: 'فشل التحقق من جلسة Google. يرجى المحاولة مرة أخرى.' });
        return;
      }

      const lookupData = (await lookupRes.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
          photoUrl?: string;
        }>;
      };

      const gUser = lookupData.users?.[0];
      if (!gUser?.localId || !gUser?.email || gUser.emailVerified === false) {
        res.status(401).json({ error: 'حساب Google غير موثق أو يفتقد البريد الإلكتروني.' });
        return;
      }

      const customer = findOrCreateGoogleCustomer({
        googleUid: gUser.localId,
        email: gUser.email,
        name: gUser.displayName || gUser.email.split('@')[0] || 'عميل ORVA 7',
        photoUrl: gUser.photoUrl || '',
      });

      const wishlistIds = Array.isArray(body.syncWishlistIds) && body.syncWishlistIds.length
        ? mergeWishlistItems(customer.id, body.syncWishlistIds)
        : getWishlistProductIds(customer.id);

      const jti = crypto.randomUUID();
      const exp = Date.now() + 1000 * 60 * 60 * 24 * 7;
      const token = signCustomerToken(
        { customerId: customer.id, email: customer.email, exp, jti },
        SESSION_SECRET
      );

      res.setHeader(
        'Set-Cookie',
        buildSessionCookieHeader(CUSTOMER_COOKIE, token, 7 * 24 * 3600, req)
      );
      res.json({
        authenticated: true,
        customer,
        wishlistIds,
        token,
      });
    } catch {
      res.status(502).json({ error: 'تعذر الاتصال بخدمة التحقق من Google حالياً.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const auth = getOptionalCustomer(req);
    if (auth) revokeToken(auth.jti);
    res.setHeader('Set-Cookie', buildSessionCookieHeader(CUSTOMER_COOKIE, '', 0, req));
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const auth = getOptionalCustomer(req);
    if (!auth) {
      res.json({ authenticated: false, customer: null, wishlistIds: [] });
      return;
    }
    const customer = getCustomerById(auth.customerId);
    if (!customer) {
      res.json({ authenticated: false, customer: null, wishlistIds: [] });
      return;
    }
    res.json({
      authenticated: true,
      customer,
      wishlistIds: getWishlistProductIds(customer.id),
    });
  });

  app.put('/api/account/profile', requireCustomer, (req: AuthedRequest, res) => {
    const body = (req.body || {}) as { name?: string; phone?: string; address?: string };
    if (body.name !== undefined && body.name.trim().length < 2) {
      res.status(400).json({ error: 'يرجى إدخال الاسم الكامل بشكل صحيح.' });
      return;
    }
    if (body.phone !== undefined && body.phone.trim() !== '' && body.phone.replace(/[^\d+]/g, '').length < 8) {
      res.status(400).json({ error: 'يرجى إدخال رقم هاتف صحيح.' });
      return;
    }
    const updated = updateCustomerProfile(req.customerUser!.customerId, body);
    if (!updated) {
      res.status(404).json({ error: 'الحساب غير موجود.' });
      return;
    }
    res.json({ customer: updated });
  });

  app.put('/api/account/password', requireCustomer, (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = (req.body || {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.' });
      return;
    }
    const hash = getCustomerPasswordHash(req.customerUser!.customerId);
    if (!hash || !verifyPassword(currentPassword, hash)) {
      res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
      return;
    }
    updateCustomerPassword(req.customerUser!.customerId, hashPassword(newPassword));
    res.json({ ok: true });
  });

  app.get('/api/account/orders', requireCustomer, (req: AuthedRequest, res) => {
    const customer = getCustomerById(req.customerUser!.customerId);
    if (!customer) {
      res.status(404).json({ error: 'الحساب غير موجود.' });
      return;
    }
    const orders = listOrdersByCustomer(customer.id, customer.phone);
    res.json({ orders });
  });

  app.get('/api/wishlist', requireCustomer, (req: AuthedRequest, res) => {
    res.json({ wishlistIds: getWishlistProductIds(req.customerUser!.customerId) });
  });

  app.post('/api/wishlist/sync', requireCustomer, (req: AuthedRequest, res) => {
    const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
    const wishlistIds = mergeWishlistItems(req.customerUser!.customerId, productIds);
    res.json({ wishlistIds });
  });

  app.post('/api/wishlist/:productId', requireCustomer, (req: AuthedRequest, res) => {
    const product = getProductByIdOrSlug(req.params.productId);
    if (!product || !product.isPublished) {
      res.status(404).json({ error: 'المنتج غير موجود.' });
      return;
    }
    const wishlistIds = addWishlistItem(req.customerUser!.customerId, product.id);
    res.json({ wishlistIds });
  });

  app.delete('/api/wishlist/:productId', requireCustomer, (req: AuthedRequest, res) => {
    const wishlistIds = removeWishlistItem(req.customerUser!.customerId, req.params.productId);
    res.json({ wishlistIds });
  });

  // ==========================================
  // Orders & Secure Online Payment Gateways
  // ==========================================

  app.post('/api/orders', (req, res) => {
    const body = (req.body || {}) as {
      customerName?: string;
      customerPhone?: string;
      customerAddress?: string;
      customerNotes?: string;
      items?: Array<{ productId: string; size: string; color: string; quantity: number }>;
    };

    const allProducts = listProducts(true);
    const productsMap = new Map(allProducts.map((p) => [p.id, p]));
    const nowMs = Date.now();
    const activeOffers = listOffers().filter((o) => isOfferActive(o, nowMs));
    const settings = getStoreSettings();
    const custAuth = getOptionalCustomer(req);

    const validation = validateOrderPayload(
      {
        customerName: body.customerName || '',
        customerPhone: body.customerPhone || '',
        customerAddress: body.customerAddress || '',
        customerNotes: body.customerNotes || '',
        items: Array.isArray(body.items) ? body.items : [],
      },
      productsMap,
      activeOffers,
      nowMs
    );

    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const order = createOrderRecord({
      customerId: custAuth?.customerId || null,
      customerName: (body.customerName || '').trim(),
      customerPhone: (body.customerPhone || '').trim(),
      customerAddress: (body.customerAddress || '').trim(),
      customerNotes: (body.customerNotes || '').trim(),
      items: validation.items,
      subtotal: validation.subtotal,
      totalPrice: validation.totalPrice,
      currencySymbol: settings.currencySymbol || 'ج.م',
      status: 'pending',
      paymentMethod: 'whatsapp_cod',
      paymentStatus: 'unpaid',
      paymentReference: '',
      paidAt: null,
    });

    const whatsapp = buildWhatsAppOrderMessage(order, settings);
    res.status(201).json({ order, whatsapp });
  });

  app.post('/api/payments/checkout', async (req, res) => {
    const body = (req.body || {}) as {
      customerName?: string;
      customerPhone?: string;
      customerAddress?: string;
      customerNotes?: string;
      paymentMethod?: 'online_card' | 'online_wallet' | 'stripe';
      cardHolder?: string;
      cardNumber?: string;
      expiry?: string;
      cvv?: string;
      walletPhone?: string;
      items?: Array<{ productId: string; size: string; color: string; quantity: number }>;
    };

    const paymentMethod = body.paymentMethod;
    if (
      paymentMethod !== 'online_card' &&
      paymentMethod !== 'online_wallet' &&
      paymentMethod !== 'stripe'
    ) {
      res.status(400).json({ error: 'وسيلة الدفع الإلكتروني غير مدعومة.' });
      return;
    }

    const allProducts = listProducts(true);
    const productsMap = new Map(allProducts.map((p) => [p.id, p]));
    const nowMs = Date.now();
    const activeOffers = listOffers().filter((o) => isOfferActive(o, nowMs));
    const settings = getStoreSettings();
    const custAuth = getOptionalCustomer(req);

    const validation = validateOrderPayload(
      {
        customerName: body.customerName || '',
        customerPhone: body.customerPhone || '',
        customerAddress: body.customerAddress || '',
        customerNotes: body.customerNotes || '',
        items: Array.isArray(body.items) ? body.items : [],
      },
      productsMap,
      activeOffers,
      nowMs
    );

    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    if (paymentMethod === 'online_card') {
      const cardRes = validateCardPaymentInput({
        cardNumber: body.cardNumber || '',
        expiry: body.expiry || '',
        cvv: body.cvv || '',
        cardHolder: body.cardHolder || '',
      });
      if (!cardRes.ok) {
        res.status(400).json({ error: cardRes.error });
        return;
      }

      const ref = `ORVPAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const paidAt = new Date().toISOString();
      const order = createOrderRecord({
        customerId: custAuth?.customerId || null,
        customerName: (body.customerName || '').trim(),
        customerPhone: (body.customerPhone || '').trim(),
        customerAddress: (body.customerAddress || '').trim(),
        customerNotes: (body.customerNotes || '').trim(),
        items: validation.items,
        subtotal: validation.subtotal,
        totalPrice: validation.totalPrice,
        currencySymbol: settings.currencySymbol || 'ج.م',
        status: 'confirmed',
        paymentMethod: 'online_card',
        paymentStatus: 'paid',
        paymentReference: `${ref} (${cardRes.brand} •••• ${cardRes.last4})`,
        paidAt,
      });
      const whatsapp = buildWhatsAppOrderMessage(order, settings);
      res.status(201).json({
        order,
        whatsapp,
        receipt: {
          reference: order.paymentReference,
          brand: cardRes.brand,
          last4: cardRes.last4,
          paidAt,
        },
      });
      return;
    }

    if (paymentMethod === 'online_wallet') {
      const walletDigits = (body.walletPhone || '').replace(/[^\d]/g, '');
      if (!/^01[0125]\d{8}$/.test(walletDigits)) {
        res.status(400).json({
          error: 'يرجى إدخال رقم محفظة إلكترونية مصري صحيح مكون من 11 رقماً (يبدأ بـ 010/011/012/015).',
        });
        return;
      }

      const ref = `ORVWALLET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const paidAt = new Date().toISOString();
      const order = createOrderRecord({
        customerId: custAuth?.customerId || null,
        customerName: (body.customerName || '').trim(),
        customerPhone: (body.customerPhone || '').trim(),
        customerAddress: (body.customerAddress || '').trim(),
        customerNotes: (body.customerNotes || '').trim(),
        items: validation.items,
        subtotal: validation.subtotal,
        totalPrice: validation.totalPrice,
        currencySymbol: settings.currencySymbol || 'ج.م',
        status: 'confirmed',
        paymentMethod: 'online_wallet',
        paymentStatus: 'paid',
        paymentReference: `${ref} (${walletDigits})`,
        paidAt,
      });
      const whatsapp = buildWhatsAppOrderMessage(order, settings);
      res.status(201).json({
        order,
        whatsapp,
        receipt: { reference: order.paymentReference, paidAt },
      });
      return;
    }

    // Stripe Checkout gateway when STRIPE_SECRET_KEY is configured
    const stripe = getStripeClient();
    if (!stripe) {
      res.status(503).json({
        error: 'بوابة Stripe غير مفعّلة حالياً على الخادم. يرجى اختيار الدفع بالبطاقة أو المحفظة الإلكترونية.',
      });
      return;
    }

    const order = createOrderRecord({
      customerId: custAuth?.customerId || null,
      customerName: (body.customerName || '').trim(),
      customerPhone: (body.customerPhone || '').trim(),
      customerAddress: (body.customerAddress || '').trim(),
      customerNotes: (body.customerNotes || '').trim(),
      items: validation.items,
      subtotal: validation.subtotal,
      totalPrice: validation.totalPrice,
      currencySymbol: settings.currencySymbol || 'ج.م',
      status: 'pending',
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
      paymentReference: '',
      paidAt: null,
    });

    const origin =
      process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
        ? process.env.APP_URL.replace(/\/$/, '')
        : `${req.protocol}://${req.get('host')}`;
    const stripeCurrency = (settings.currency || 'egp').toLowerCase();

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        client_reference_id: order.id,
        line_items: order.items.map((it) => ({
          quantity: it.quantity,
          price_data: {
            currency: stripeCurrency,
            unit_amount: Math.round(it.unitPrice * 100),
            product_data: {
              name: `${it.productName} (${it.size} / ${it.color})`,
            },
          },
        })),
        success_url: `${origin}/?stripe_session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(order.id)}`,
        cancel_url: `${origin}/?stripe_cancelled=1&order_id=${encodeURIComponent(order.id)}`,
      });

      updateOrderPayment(order.id, 'pending', session.id);
      res.status(201).json({
        order,
        redirectUrl: session.url,
        sessionId: session.id,
      });
    } catch (err) {
      updateOrderPayment(order.id, 'failed', 'STRIPE_INIT_ERROR');
      res.status(502).json({
        error: err instanceof Error ? err.message : 'تعذر بدء جلسة الدفع عبر Stripe.',
      });
    }
  });

  app.post('/api/payments/stripe/verify', async (req, res) => {
    const { sessionId, orderId } = (req.body || {}) as { sessionId?: string; orderId?: string };
    const stripe = getStripeClient();
    if (!stripe || !sessionId || !orderId) {
      res.status(400).json({ error: 'بيانات التحقق من الدفع غير مكتملة.' });
      return;
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        const updated = updateOrderPayment(
          orderId,
          'paid',
          String(session.payment_intent || session.id),
          'confirmed'
        );
        if (!updated) {
          res.status(404).json({ error: 'الطلب غير موجود.' });
          return;
        }
        const whatsapp = buildWhatsAppOrderMessage(updated, getStoreSettings());
        res.json({ paid: true, order: updated, whatsapp });
        return;
      }
      res.json({ paid: false });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'تعذر التحقق من حالة الدفع عبر Stripe.',
      });
    }
  });

  // ==========================================
  // AI Customer Service Assistant API
  // ==========================================

  app.post('/api/ai/chat', async (req, res) => {
    const body = (req.body || {}) as {
      message?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
    };
    const message = (body.message || '').trim();
    if (!message) {
      res.status(400).json({ error: 'يرجى كتابة رسالتك أولاً.' });
      return;
    }
    if (message.length > 2000) {
      res.status(400).json({ error: 'الرسالة طويلة جداً، يرجى الاختصار.' });
      return;
    }

    const settings = getStoreSettings();
    const categories = listCategories(true);
    const collections = listCollections(true);
    const nowMs = Date.now();
    const activeOffers = listOffers().filter((o) => isOfferActive(o, nowMs));
    const products = listProducts(true);
    const reviewSummaries = getReviewSummariesMap();

    try {
      const reply = await generateOrvaAssistantReply({
        message,
        history: Array.isArray(body.history) ? body.history : [],
        snapshot: {
          settings,
          categories,
          collections,
          activeOffers,
          products,
          reviewSummaries,
        },
      });
      res.json({ reply });
    } catch (err) {
      const statusCode =
        typeof (err as { statusCode?: number }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;
      res.status(statusCode).json({
        error:
          err instanceof Error
            ? err.message
            : 'خدمة المساعد الذكي غير متاحة مؤقتاً، يمكنك التواصل عبر واتساب.',
      });
    }
  });

  // ==========================================
  // Admin Authentication API
  // ==========================================

  app.post('/api/admin/login', (req, res) => {
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    const cleanUser = (username || '').trim();
    const cleanPass = password || '';

    if (!cleanUser || !cleanPass) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
      return;
    }

    const admin = getAdminUser(cleanUser);
    if (!admin || !verifyPassword(cleanPass, admin.passwordHash)) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
      return;
    }

    const jti = crypto.randomUUID();
    const exp = Date.now() + 1000 * 60 * 60 * 12; // 12h
    const token = signSessionToken({ username: admin.username, exp, jti }, SESSION_SECRET);

    res.setHeader(
      'Set-Cookie',
      buildSessionCookieHeader(SESSION_COOKIE, token, 12 * 3600, req)
    );
    res.json({ authenticated: true, username: admin.username, token });
  });

  app.post('/api/admin/logout', (req, res) => {
    const cookies = parseCookies(req);
    const token = extractBearerToken(req) || cookies[SESSION_COOKIE];
    if (token) {
      const verified = verifySessionToken(token, SESSION_SECRET);
      if (verified) revokeToken(verified.jti);
    }
    res.setHeader('Set-Cookie', buildSessionCookieHeader(SESSION_COOKIE, '', 0, req));
    res.json({ ok: true });
  });

  app.get('/api/admin/me', (req, res) => {
    const cookies = parseCookies(req);
    const token = extractBearerToken(req) || cookies[SESSION_COOKIE];
    if (!token) {
      res.json({ authenticated: false });
      return;
    }
    const verified = verifySessionToken(token, SESSION_SECRET);
    if (!verified || isTokenRevoked(verified.jti)) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: verified.username });
  });

  // ==========================================
  // Protected Admin Dashboard API
  // ==========================================

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const products = listProducts(false);
    const categories = listCategories(false);
    const collections = listCollections(false);
    const orders = listOrders();
    const offers = listOffers();

    const publishedProducts = products.filter((p) => p.isPublished).length;
    const activeOffers = offers.filter((o) => isOfferActive(o)).length;
    const totalRevenue = orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.totalPrice, 0);
    const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
    const paidRevenue = paidOrders.reduce((sum, o) => sum + o.totalPrice, 0);

    res.json({
      stats: {
        totalProducts: products.length,
        publishedProducts,
        totalCategories: categories.length,
        totalCollections: collections.length,
        totalOrders: orders.length,
        pendingOrders: orders.filter((o) => o.status === 'pending').length,
        paidOrders: paidOrders.length,
        activeOffers,
        totalRevenue,
        paidRevenue,
      },
      recentOrders: orders.slice(0, 6),
    });
  });

  // Products CRUD
  app.get('/api/admin/products', requireAdmin, (_req, res) => {
    const products = listProducts(false);
    const offers = listOffers();
    const enriched = products.map((p) => ({
      ...p,
      pricing: computeEffectivePricing(p, offers),
    }));
    res.json({ products: enriched });
  });

  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      res.status(400).json({ error: 'اسم المنتج مطلوب.' });
      return;
    }
    if (Number(body.price) < 0 || Number.isNaN(Number(body.price))) {
      res.status(400).json({ error: 'سعر المنتج غير صالح.' });
      return;
    }
    const created = createProduct(body);
    res.status(201).json({ product: created });
  });

  app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
    const body = req.body || {};
    if (body.name !== undefined && !String(body.name).trim()) {
      res.status(400).json({ error: 'اسم المنتج لا يمكن أن يكون فارغاً.' });
      return;
    }
    const updated = updateProduct(req.params.id, body);
    if (!updated) {
      res.status(404).json({ error: 'المنتج غير موجود.' });
      return;
    }
    res.json({ product: updated });
  });

  app.patch('/api/admin/products/:id/publish', requireAdmin, (req, res) => {
    const { isPublished } = (req.body || {}) as { isPublished?: boolean };
    const updated = updateProduct(req.params.id, { isPublished: Boolean(isPublished) });
    if (!updated) {
      res.status(404).json({ error: 'المنتج غير موجود.' });
      return;
    }
    res.json({ product: updated });
  });

  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    const ok = deleteProduct(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'المنتج غير موجود.' });
      return;
    }
    res.json({ ok: true });
  });

  // Categories CRUD
  app.get('/api/admin/categories', requireAdmin, (_req, res) => {
    res.json({ categories: listCategories(false) });
  });

  app.post('/api/admin/categories', requireAdmin, (req, res) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      res.status(400).json({ error: 'اسم الفئة مطلوب.' });
      return;
    }
    const created = createCategory(body);
    res.status(201).json({ category: created });
  });

  app.put('/api/admin/categories/:id', requireAdmin, (req, res) => {
    const updated = updateCategory(req.params.id, req.body || {});
    if (!updated) {
      res.status(404).json({ error: 'الفئة غير موجودة.' });
      return;
    }
    res.json({ category: updated });
  });

  app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
    const ok = deleteCategory(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'الفئة غير موجودة.' });
      return;
    }
    res.json({ ok: true });
  });

  // Collections CRUD
  app.get('/api/admin/collections', requireAdmin, (_req, res) => {
    res.json({ collections: listCollections(false) });
  });

  app.post('/api/admin/collections', requireAdmin, (req, res) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      res.status(400).json({ error: 'اسم المجموعة مطلوب.' });
      return;
    }
    const created = createCollection(body);
    res.status(201).json({ collection: created });
  });

  app.put('/api/admin/collections/:id', requireAdmin, (req, res) => {
    const updated = updateCollection(req.params.id, req.body || {});
    if (!updated) {
      res.status(404).json({ error: 'المجموعة غير موجودة.' });
      return;
    }
    res.json({ collection: updated });
  });

  app.delete('/api/admin/collections/:id', requireAdmin, (req, res) => {
    const ok = deleteCollection(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'المجموعة غير موجودة.' });
      return;
    }
    res.json({ ok: true });
  });

  // Offers CRUD
  app.get('/api/admin/offers', requireAdmin, (_req, res) => {
    const nowMs = Date.now();
    const offers = listOffers().map((o) => ({
      ...o,
      isCurrentlyActive: isOfferActive(o, nowMs),
    }));
    res.json({ offers });
  });

  app.post('/api/admin/offers', requireAdmin, (req, res) => {
    const body = req.body || {};
    if (!body.title || !String(body.title).trim()) {
      res.status(400).json({ error: 'عنوان العرض مطلوب.' });
      return;
    }
    const created = createOffer(body);
    res.status(201).json({ offer: created });
  });

  app.put('/api/admin/offers/:id', requireAdmin, (req, res) => {
    const updated = updateOffer(req.params.id, req.body || {});
    if (!updated) {
      res.status(404).json({ error: 'العرض غير موجود.' });
      return;
    }
    res.json({ offer: updated });
  });

  app.delete('/api/admin/offers/:id', requireAdmin, (req, res) => {
    const ok = deleteOffer(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'العرض غير موجود.' });
      return;
    }
    res.json({ ok: true });
  });

  // Homepage Editor
  app.get('/api/admin/homepage', requireAdmin, (_req, res) => {
    res.json({ homepage: getHomepageConfig() });
  });

  app.put('/api/admin/homepage', requireAdmin, (req, res) => {
    const updated = updateHomepageConfig(req.body as HomepageConfig);
    res.json({ homepage: updated });
  });

  // Orders Manager
  app.get('/api/admin/orders', requireAdmin, (_req, res) => {
    res.json({ orders: listOrders() });
  });

  app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
    const status = String(req.body?.status || '') as OrderStatus;
    if (!VALID_ORDER_STATUSES.includes(status)) {
      res.status(400).json({ error: 'حالة الطلب غير صالحة.' });
      return;
    }
    const updated = updateOrderStatus(req.params.id, status);
    if (!updated) {
      res.status(404).json({ error: 'الطلب غير موجود.' });
      return;
    }
    res.json({ order: updated });
  });

  app.patch('/api/admin/orders/:id/payment', requireAdmin, (req, res) => {
    const paymentStatus = String(req.body?.paymentStatus || '') as PaymentStatus;
    if (!VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      res.status(400).json({ error: 'حالة الدفع غير صالحة.' });
      return;
    }
    const paymentReference =
      typeof req.body?.paymentReference === 'string' ? req.body.paymentReference : undefined;
    const updated = updateOrderPayment(req.params.id, paymentStatus, paymentReference);
    if (!updated) {
      res.status(404).json({ error: 'الطلب غير موجود.' });
      return;
    }
    res.json({ order: updated });
  });

  // Store Settings & Password
  app.get('/api/admin/settings', requireAdmin, (_req, res) => {
    res.json({ settings: getStoreSettings() });
  });

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const body = req.body as StoreSettings;
    if (!body || !body.storeName?.trim()) {
      res.status(400).json({ error: 'اسم المتجر مطلوب.' });
      return;
    }
    const updated = updateStoreSettings(body);
    res.json({ settings: updated });
  });

  app.put('/api/admin/password', requireAdmin, (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = (req.body || {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.' });
      return;
    }
    const username = req.adminUser?.username || 'admin';
    const admin = getAdminUser(username);
    if (!admin || !verifyPassword(currentPassword, admin.passwordHash)) {
      res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
      return;
    }
    updateAdminPassword(username, hashPassword(newPassword));
    res.json({ ok: true });
  });

  // Protected Image Upload (base64 data URI -> persistent file in data/uploads)
  app.post('/api/admin/upload', requireAdmin, (req, res) => {
    const { dataUrl, filename } = (req.body || {}) as { dataUrl?: string; filename?: string };
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'ملف الصورة مطلوب.' });
      return;
    }

    const match = /^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl
    );
    if (!match) {
      res.status(400).json({ error: 'صيغة الصورة غير مدعومة (PNG, JPG, WEBP فقط).' });
      return;
    }

    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'حجم الصورة يتجاوز الحد المسموح (5 ميجابايت).' });
      return;
    }

    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    const ext = extMap[mime] || 'jpg';
    const safeBase = (filename || 'asset')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 32) || 'orva';
    const outName = `${safeBase}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    const outPath = path.join(UPLOADS_DIR, outName);

    fs.writeFileSync(outPath, buffer);
    res.status(201).json({ url: `/uploads/${outName}` });
  });

  // ==========================================
  // Frontend Serving (Vite Dev / Static Prod)
  // ==========================================

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
    });

    app.get(['/admin', '/admin/'], async (req, res, next) => {
      try {
        const htmlPath = path.resolve(process.cwd(), 'admin.html');
        const raw = fs.readFileSync(htmlPath, 'utf8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, raw);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(transformed);
      } catch (err) {
        next(err);
      }
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get(['/admin', '/admin/'], (_req, res) => {
      res.sendFile(path.join(distDir, 'admin.html'));
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ORVA 7 server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ORVA 7 server:', err);
  process.exit(1);
});
