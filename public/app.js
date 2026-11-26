'use strict';
/* =====================================================================
   Agent UZ — mijoz, admin va super admin panellari (brauzer qismi)
   Ma'lumotlar serverdan /api orqali olinadi, o'zgarishlar /api/events
   orqali real vaqtda keladi.
   ===================================================================== */

/* ---------- Doimiy qiymatlar ---------- */
const STATUS = {
  yangi:      { label: 'Yangi',         cls: 'st-new' },
  yigilmoqda: { label: "Yig'ilmoqda",   cls: 'st-pick' },
  yolda:      { label: "Yo'lda",        cls: 'st-road' },
  yetkazildi: { label: 'Yetkazildi',    cls: 'st-done' },
  bekor:      { label: 'Bekor qilindi', cls: 'st-cancel' },
};
const FLOW = ['yangi', 'yigilmoqda', 'yolda', 'yetkazildi'];
const ACTIVE = ['yangi', 'yigilmoqda', 'yolda'];
const NEXT = {
  yangi:      { to: 'yigilmoqda', label: "Yig'ishni boshlash" },
  yigilmoqda: { to: 'yolda',      label: "Yo'lga chiqarish" },
  yolda:      { to: 'yetkazildi', label: 'Yetkazildi ✓' },
};
const MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
const WD = ['Ya','Du','Se','Ch','Pa','Ju','Sh'];
const WD_FULL = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'];
const DAY = 86400000;

/* ---------- Yordamchilar ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const sp = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const money = n => sp(Math.round(n || 0)) + " so'm";
const num = n => String(Math.round(n * 100) / 100).replace('.', ',');
const shortMoney = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mln' : n >= 1e3 ? Math.round(n / 1e3) + ' ming' : String(n);
const fmtDate = ts => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const fmtTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDT = ts => `${fmtDate(ts)} ${fmtTime(ts)}`;
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const digits = s => String(s).replace(/\D/g, '');
const fmtPhone = p => { p = String(p || ''); return p.length !== 12 ? '+' + p : `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}`; };
const localDigits = v => { let d = digits(v); if (d.length > 9 && d.startsWith('998')) d = d.slice(3); return d.slice(0, 9); };
const fmtLocal = d => [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
const val = (f, n) => (f.elements[n]?.value ?? '').trim();
const badge = s => `<span class="badge-st ${STATUS[s].cls}">${STATUS[s].label}</span>`;
const empty = (icon, text, extra = '') => `<div class="empty"><div class="big">${icon}</div><p>${text}</p>${extra}</div>`;
const loadingHtml = () => `<div class="empty"><div class="spinner" aria-hidden="true"></div><p>Yuklanmoqda...</p></div>`;
const custLabel = s => (s === 'yangi' ? 'Qabul qilindi' : STATUS[s].label);

/* ---------- Server bilan aloqa ---------- */
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body ?? {}); }
  let res;
  try { res = await fetch('/api' + path, opts); } catch { throw new ApiError("Server bilan aloqa yo'q. Internetni tekshiring.", 0); }
  let data = null;
  try { data = await res.json(); } catch { /* bo'sh javob */ }
  if (!res.ok) {
    if (res.status === 401 && S.me && !path.startsWith('/auth/')) onLoggedOut("Sessiya tugadi. Qaytadan kiring.");
    throw new ApiError(data?.error || 'Xatolik yuz berdi', res.status);
  }
  return data;
}
const fail = e => toast(e?.message || 'Xatolik yuz berdi');

/* ---------- Holat ---------- */
const S = {
  cfg: { appName: 'Agent UZ' }, me: null, units: [], products: [],
  myOrders: [], myOrdersTotal: 0,
  adm: { orders: [], counts: {}, total: 0, today: { count: 0, sum: 0 } },
  customers: [], report: null, stockRep: null, convs: [], thread: { cid: null, messages: [] },
  summary: { newOrders: 0, unread: 0 }, loaded: {}, orderCache: new Map(), admins: [],
};
const ui = {
  custTab: 'katalog', cat: 'Hammasi', q: '', adminTab: 'buyurtmalar', orderFilter: 'faol', orderLimit: 40,
  myLimit: 30, rType: 'kunlik', rDate: ymd(new Date()), rBasis: 'yetkazildi', rView: 'savdo', openOrderId: null, chatWith: null, drafts: {},
  formPhoto: '', formPhotoOrig: '',
};
const isAdmin = () => S.me?.role === 'admin';
const isSuper = () => S.me?.role === 'superadmin';
const tabKey = () => (isSuper() ? 's:admins' : isAdmin() ? 'a:' + ui.adminTab : 'c:' + ui.custTab);
// Asosiy sahifa (/) — mijozlar va adminlar telefon bilan kiradi; /super — super admin login bilan kiradi
const HOME_TITLE = document.title;   // Google uchun to'liq sarlavha (index.html dan)
const SUPER_PAGE = location.pathname.replace(/\/+$/, '') === '/super';

/* ---------- Savat (shu qurilmada saqlanadi) ---------- */
let cart = {};
const cartKey = () => `taminot_cart_${S.me?.id}`;
function loadCart() { try { cart = JSON.parse(localStorage.getItem(cartKey()) || '{}') || {}; } catch { cart = {}; } }
function saveCart() { try { localStorage.setItem(cartKey(), JSON.stringify(cart)); } catch { /* */ } }
const prod = id => S.products.find(p => p.id === Number(id));
const cartItems = () => Object.entries(cart).map(([id, q]) => ({ p: prod(id), q })).filter(x => x.p && x.p.active && x.q > 0);

/* ---------- Ma'lumot yuklash ---------- */
async function loadProducts() { const d = await api('/products'); S.products = d.products; S.units = d.units; }
async function loadMyOrders() { const d = await api(`/orders?limit=${ui.myLimit}`); S.myOrders = d.orders; S.myOrdersTotal = d.total; d.orders.forEach(o => S.orderCache.set(o.id, o)); }
async function loadAdminOrders() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  S.adm = await api(`/orders?status=${ui.orderFilter}&limit=${ui.orderLimit}&since=${t0.getTime()}`);
  S.adm.orders.forEach(o => S.orderCache.set(o.id, o));
}
async function loadCustomers() { const d = await api('/admin/customers'); S.customers = d.customers; S.custLimit = d.limit; }
async function loadReport() {
  const p = period();
  if (ui.rView === 'ombor') { const r = await api(`/admin/stock-report?from=${p.from}&to=${p.to}`); r.label = p.label; S.stockRep = r; return; }
  const r = await api(`/admin/reports?from=${p.from}&to=${p.to}&basis=${ui.rBasis}`); r.label = p.label; S.report = r;
}
async function loadConvs() { S.convs = (await api('/chat/conversations')).conversations; }
async function loadSummary() { S.summary = await api('/summary'); }
async function loadAdmins() { S.admins = (await api('/super/admins')).admins; }
async function loadThread(cid) {
  const d = await api('/chat/messages' + (isAdmin() ? `?customerId=${cid}` : ''));
  if (isAdmin() && ui.chatWith !== cid) return;
  S.thread = { cid, messages: d.messages };
  await markRead(cid);
}
// Ochiq turgan suhbatdagi qarshi tomon xabarlarini "o'qildi" deb belgilaymiz
async function markRead(cid) {
  if (document.hidden) return;
  const other = isAdmin() ? 'customer' : 'admin';
  if (!S.thread.messages.some(m => m.sender === other && !m.readAt)) return;
  await api('/chat/read', { method: 'POST', body: isAdmin() ? { customerId: cid } : {} });
  S.thread.messages.forEach(m => { if (m.sender === other && !m.readAt) m.readAt = Date.now(); });
  const c = S.convs.find(x => x.customer.id === cid); if (c) c.unread = 0;
  await loadSummary();
}

// Hozirgi bo'lim ma'lumotlarini qayta yuklab, ekranni yangilaymiz
let refreshing = null, refreshAgain = false;
async function refresh() {
  if (!S.me) return;
  if (refreshing) { refreshAgain = true; return refreshing; }
  refreshing = (async () => {
    const key = tabKey();
    try {
      const jobs = isSuper() ? [loadAdmins()] : [loadSummary()];
      if (isSuper()) { /* faqat adminlar ro'yxati */ }
      else if (isAdmin()) {
        const t = ui.adminTab;
        if (t === 'buyurtmalar') jobs.push(loadAdminOrders());
        if (t === 'mahsulotlar' || t === 'ombor') jobs.push(loadProducts());
        if (t === 'hisobotlar') jobs.push(loadReport());
        if (t === 'mijozlar') jobs.push(loadCustomers());
        if (t === 'chat') { jobs.push(loadConvs(), loadCustomers()); if (ui.chatWith) jobs.push(loadThread(ui.chatWith)); }
      } else {
        const t = ui.custTab;
        if (t === 'katalog' || t === 'savat') jobs.push(loadProducts());
        if (t === 'buyurtmalar') jobs.push(loadMyOrders());
        if (t === 'chat') jobs.push(loadThread(S.me.id));
      }
      await Promise.all(jobs);
      S.loaded[key] = true;
    } catch (e) { if (e.status !== 401) fail(e); }
    if (!S.me) return;
    render();
    if (ui.openOrderId && !$('#modal').classList.contains('hidden') && !$('#modalBox form')) openOrder(ui.openOrderId, true);
  })();
  try { await refreshing; } finally { refreshing = null; }
  if (refreshAgain) { refreshAgain = false; return refresh(); }
}
let soonTimer = null;
const soon = () => { clearTimeout(soonTimer); soonTimer = setTimeout(refresh, 150); };

/* ---------- Real vaqtdagi xabarlar ---------- */
let es = null, esBroken = false;
function startEvents() {
  stopEvents();
  es = new EventSource('/api/events');
  es.addEventListener('order:new', e => {
    const d = JSON.parse(e.data);
    if (isAdmin()) { toast(`🔔 Yangi buyurtma #${d.id} — ${d.shop} · ${money(d.total)}`, 'openOrder', d.id); beep(); }
    soon();
  });
  es.addEventListener('order:status', e => {
    const d = JSON.parse(e.data);
    if (!isAdmin()) { toast(`Buyurtma #${d.id}: ${custLabel(d.status)}`); beep(); }
    soon();
  });
  es.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    const mine = isAdmin() ? d.sender === 'admin' : d.sender === 'customer';
    if (!mine) {
      const viewing = !document.hidden && (isAdmin() ? ui.adminTab === 'chat' && ui.chatWith === d.customerId : ui.custTab === 'chat');
      if (!viewing) toast(`💬 ${d.from}: ${d.text || 'Rasm'}`, 'goChat', d.customerId);
      beep();
    }
    soon();
  });
  es.addEventListener('read', soon);
  es.addEventListener('products', () => { if (!isAdmin() || ui.adminTab === 'mahsulotlar' || ui.adminTab === 'ombor' || (ui.adminTab === 'hisobotlar' && ui.rView === 'ombor')) soon(); });
  es.onerror = () => { esBroken = true; };
  es.onopen = () => { if (esBroken) { esBroken = false; soon(); } };
}
function stopEvents() { if (es) { es.close(); es = null; } }

/* ---------- Kirish / chiqish ---------- */
function afterLogin(user) {
  S.me = user;
  S.loaded = {}; S.orderCache.clear();
  ui.custTab = 'katalog'; ui.adminTab = 'buyurtmalar'; ui.chatWith = null; ui.drafts = {};
  loadCart(); if (!isSuper()) startEvents(); closeModal(); render(); scrollTo(0, 0); refresh();
}
function onLoggedOut(msg) {
  S.me = null; stopEvents(); cart = {};
  Object.assign(S, { products: [], myOrders: [], customers: [], report: null, stockRep: null, convs: [], thread: { cid: null, messages: [] }, summary: { newOrders: 0, unread: 0 }, loaded: {}, admins: [] });
  closeModal(); render(); if (msg) toast(msg);
}

/* =====================================================================
   Ekranlar
   ===================================================================== */
function render() {
  const app = $('#app');
  const ae = document.activeElement;
  const keep = ae && ae.id && app.contains(ae) ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const body = $('#chatBody');
  const chatState = body ? { top: body.scrollTop, atBottom: body.scrollHeight - body.scrollTop - body.clientHeight < 60, n: body.dataset.n } : null;

  app.innerHTML = !S.me ? viewAuth() : isSuper() ? viewSuper() : isAdmin() ? viewAdmin() : viewCustomer(S.me);

  if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch { /* */ } } }
  fitChat(chatState); autoGrow();
  const n = S.summary.newOrders + S.summary.unread;
  document.title = !S.me && !SUPER_PAGE ? HOME_TITLE : `${S.me && n ? `(${n}) ` : ''}${S.cfg.appName}${isSuper() || (!S.me && SUPER_PAGE) ? ' — Super admin' : isAdmin() ? ' — Admin' : ''}`;
}

const ICONS = {
  katalog: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  savat: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L22 7H6"/>',
  buyurtmalar: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/>',
  mahsulotlar: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  ombor: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-9h10v9"/><path d="M7 15h10M7 18h10"/>',
  hisobotlar: '<path d="M3 21h18"/><path d="M6 17v-6M11 17V5M16 17v-8M21 17v-4"/>',
  mijozlar: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  clip: '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const icon = k => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;
const IMG_ICON = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
const photoHtml = p => (p && p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : IMG_ICON);
const navHtml = (action, current, tabs) => `<nav class="wrap tabs">${tabs.map(([k, l, b, red]) =>
  `<button data-a="${action}" data-id="${k}" class="${current === k ? 'on' : ''}">${icon(k)}<span class="tl">${l}</span>${b ? `<span class="badge ${red ? 'red' : ''}">${b}</span>` : ''}</button>`).join('')}</nav>`;
// Logo + nom: oxirgi so'z apelsin rangda (AGENT UZ)
function brandHtml() {
  const words = String(S.cfg.appName).trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : '';
  return `<span class="logo-chip"><img src="/logo-icon.png" alt="" width="32" height="32"></span>`
    + `<span class="brand-name">${esc(words.join(' ').toUpperCase())}${last ? ` <em>${esc(last.toUpperCase())}</em>` : ''}</span>`;
}
// kind: 'customer' | 'admin' | 'super'
const header = (u, kind) => `
  <div class="wrap bar"><div class="brand">${brandHtml()}${kind === 'admin' ? ' <small>Admin panel</small>' : kind === 'super' ? ' <small>Super admin</small>' : ''}</div>
    <button class="who" data-a="profile" title="Profil va parol"><b>${esc(kind === 'customer' ? (u.shop || u.name) : u.name)}</b><span>${kind === 'super' ? esc(u.login) : fmtPhone(u.phone)}</span></button>
    ${kind === 'super' ? '<button class="btn sm dark" data-a="password" title="Parolni almashtirish">🔑 Parol</button>' : ''}
    <button class="btn sm ${kind === 'customer' ? '' : 'dark'}" data-a="logout">Chiqish</button></div>`;

/* ---------- Kirish / ro'yxatdan o'tish ---------- */
const phoneField = () => `<label>Telefon raqam<div class="phone"><span>+998</span><input name="phone" id="authPhone" inputmode="numeric" autocomplete="tel" placeholder="90 123 45 67" data-phone required></div></label>`;
function viewSuperLogin() {
  return `<div class="auth-wrap"><div class="card auth">
    <img class="auth-logo sm" src="/logo.png" alt="${esc(S.cfg.appName)}" width="469" height="206">
    <div class="brand big">🛡️ Super admin</div>
    <p class="sub muted">${esc(S.cfg.appName)} — admin hisoblarini boshqarish</p>
    <form data-form="superLogin" class="super-form">
      <label>Login<input name="login" id="superLogin" required maxlength="40" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Loginingiz"></label>
      <label>Parol<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary block lg">Super admin sifatida kirish</button>
    </form>
    <div id="authErr" class="err" role="alert"></div>
  </div>
  <a class="alt-link" href="/">← Mijozlar va adminlar kirishi</a></div>`;
}
function viewAuth() {
  if (SUPER_PAGE) return viewSuperLogin();
  return `<div class="auth-wrap">
    <div class="card auth">
      <img class="auth-logo" src="/logo.png" alt="${esc(S.cfg.appName)}" width="469" height="206">
      <h1 class="sub muted auth-h1">Jizzax do'konlariga oziq-ovqat buyurtma tizimi</h1>
      <p class="sub muted">Mijozlar va adminlar uchun kirish</p>
      <form data-form="login">
        ${phoneField()}
        <label>Parol<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary block lg">Kirish</button>
      </form>
      <div id="authErr" class="err" role="alert"></div>
    </div>
    <p class="muted small center">Hisobingiz yo'qmi? Ta'minotchingiz sizni ro'yxatga qo'shib, telefon raqam va parol beradi.<br>Parolni unutsangiz ham ta'minotchiga qo'ng'iroq qiling — yangi parol qo'yib beradi.</p>
    <div class="or-sep"><span>yoki</span></div>
    <a class="btn block alt-login" href="/super">🛡️ Super admin sifatida kirish</a>
    <p class="muted small center about">${esc(S.cfg.appName)} — Jizzax viloyati bo'yicha do'konlarga oziq-ovqat yetkazib beruvchi ortakashlar (ta'minotchilar) uchun buyurtma tizimi. Do'konlar katalogdan mahsulot tanlab, telefondan buyurtma beradi va uning holatini kuzatadi. Ortakash esa buyurtmalar, ombor qoldig'i, kunlik va oylik hisobotlarni bir joyda boshqaradi.</p>
  </div>`;
}
const authErr = msg => { const e = $('#authErr'); if (e) e.textContent = msg; };

/* ---------- Mijoz paneli ---------- */
function viewCustomer(u) {
  const items = cartItems(), cnt = items.length, total = items.reduce((s, x) => s + x.p.price * x.q, 0);
  const tabs = [['katalog', 'Katalog'], ['savat', 'Savat', cnt], ['buyurtmalar', 'Buyurtmalarim'], ['chat', 'Chat', S.summary.unread, true]];
  const ready = S.loaded[tabKey()];
  const body = !ready ? loadingHtml() : { katalog: () => viewCatalog(), savat: () => viewCart(u, items, total), buyurtmalar: () => viewMyOrders(), chat: () => viewCustChat() }[ui.custTab]();
  return `<header class="top">${header(u, 'customer')}${navHtml('custTab', ui.custTab, tabs)}</header>
    <main class="wrap ${ui.custTab === 'chat' ? 'chat-page' : ''}">${body}</main>
    ${cnt && ui.custTab === 'katalog' ? `<button class="cartbar" data-a="custTab" data-id="savat"><span>🛒 ${cnt} ta · ${money(total)}</span><span>Savatga o'tish →</span></button>` : ''}`;
}
function viewCatalog() {
  const active = S.products.filter(p => p.active);
  if (!active.length) return empty('📦', "Hozircha mahsulotlar yo'q. Tez orada qo'shiladi.");
  const cats = ['Hammasi', ...new Set(active.map(p => p.category))];
  if (!cats.includes(ui.cat)) ui.cat = 'Hammasi';
  return `<input id="search" class="search" type="search" placeholder="🔍 Mahsulot qidirish..." value="${esc(ui.q)}" aria-label="Mahsulot qidirish">
    <div class="chips">${cats.map(c => `<button class="chip ${ui.cat === c ? 'on' : ''}" data-a="cat" data-id="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="grid" class="grid">${gridHtml()}</div>`;
}
function gridHtml() {
  const q = ui.q.trim().toLowerCase();
  const list = S.products.filter(p => p.active && (ui.cat === 'Hammasi' || p.category === ui.cat) && (!q || p.name.toLowerCase().includes(q)));
  if (!list.length) return `<div style="grid-column:1/-1">${empty('🔍', 'Hech narsa topilmadi')}</div>`;
  return list.map(p => {
    const n = cart[p.id] || 0;
    return `<div class="pcard"><div class="pimg">${photoHtml(p)}</div><div class="pcat">${esc(p.category)}</div>
      <div class="pname">${esc(p.name)}</div>
      <div class="pprice">${money(p.price)} <span>/ ${esc(p.unit)}</span></div>
      ${p.soldOut ? `<button class="btn block" disabled>Tugagan</button>`
        : n ? qtyCtl(p.id, n) : `<button class="btn primary block" data-a="add" data-id="${p.id}">Savatga</button>`}</div>`;
  }).join('');
}
const qtyCtl = (id, n) => `<div class="qty"><button data-a="dec" data-id="${id}" aria-label="kamaytirish">−</button><input data-qty="${id}" value="${num(n)}" inputmode="decimal" aria-label="miqdor"><button data-a="inc" data-id="${id}" aria-label="ko'paytirish">+</button></div>`;
function setQty(id, v) {
  const n = Math.round(Number(String(v).replace(',', '.')) * 100) / 100;
  if (!(n > 0)) delete cart[id]; else cart[id] = Math.min(n, 100000);
  saveCart(); render();
}
function viewCart(u, items, total) {
  if (!items.length) return empty('🛒', "Savat bo'sh", `<button class="btn primary" data-a="custTab" data-id="katalog">Katalogga o'tish</button>`);
  return `<div class="card">
    <h3>Savat</h3>
    ${items.map(({ p, q }) => `<div class="cart-row">
      <div class="ci-info"><div>${esc(p.name)}</div><div class="muted small">${money(p.price)} / ${esc(p.unit)}</div></div>
      ${qtyCtl(p.id, q)}
      <div class="ci-sum">${money(p.price * q)}</div>
      <button class="x" data-a="rm" data-id="${p.id}" title="O'chirish" aria-label="O'chirish">✕</button></div>`).join('')}
    <form data-form="placeOrder" class="order-form">
      <label>Yetkazib berish manzili<input name="address" value="${esc(u.address)}" required maxlength="300"></label>
      <label>Izoh (ixtiyoriy)<textarea name="comment" rows="2" maxlength="500" placeholder="Masalan: ertalab soat 10 gacha olib keling"></textarea></label>
      <div class="total-row"><span>Jami:</span><b>${money(total)}</b></div>
      <button class="btn primary block lg">Buyurtma berish</button>
      <p class="muted small center" style="margin:8px 0 0">Yakuniy narx buyurtma qabul qilingan paytdagi narx bo'yicha hisoblanadi.</p>
    </form></div>`;
}
function steps(o) {
  if (o.status === 'bekor') return `<div class="steps cancel">✕ Buyurtma bekor qilingan</div>`;
  const idx = FLOW.indexOf(o.status);
  return `<div class="steps">${FLOW.map((s, i) => `<div class="step ${i <= idx ? 'done' : ''} ${i === idx ? 'cur' : ''}"><i></i><span>${custLabel(s)}</span></div>`).join('')}</div>`;
}
const itemsHtml = o => `<div class="o-items">${o.items.map(i => `<div><span>${esc(i.name)}</span><span>${num(i.qty)} ${esc(i.unit)} × ${money(i.price)}</span></div>`).join('')}</div>`;
function viewMyOrders() {
  if (!S.myOrders.length) return empty('📋', 'Hali buyurtma bermagansiz', `<button class="btn primary" data-a="custTab" data-id="katalog">Katalogga o'tish</button>`);
  return `<div class="stack">${S.myOrders.map(o => `<div class="card">
      <div class="o-head"><b>Buyurtma #${o.id}</b>${badge(o.status)}<span class="muted small right">${fmtDT(o.createdAt)}</span></div>
      ${steps(o)}
      <details ${ACTIVE.includes(o.status) ? 'open' : ''}><summary>${o.items.length} ta mahsulot</summary>${itemsHtml(o)}</details>
      <div class="o-foot"><b>Jami: ${money(o.total)}</b>
        <div class="row gap wrapf">${o.status === 'yangi' ? `<button class="btn sm danger" data-a="custCancel" data-id="${o.id}">Bekor qilish</button>` : ''}
        <button class="btn sm" data-a="askOrder" data-id="${o.id}">Savol berish</button>
        <button class="btn sm" data-a="reorder" data-id="${o.id}">↻ Takrorlash</button></div></div>
    </div>`).join('')}
    ${S.myOrdersTotal > S.myOrders.length ? `<div class="center"><button class="btn" data-a="moreMy">Yana ko'rsatish</button></div>` : ''}</div>`;
}

/* ---------- Admin paneli ---------- */
function viewAdmin() {
  const tabs = [['buyurtmalar', 'Buyurtmalar', S.summary.newOrders, true], ['mahsulotlar', 'Mahsulotlar'], ['ombor', 'Ombor'], ['hisobotlar', 'Hisobotlar'], ['mijozlar', 'Mijozlar'], ['chat', 'Chat', S.summary.unread, true]];
  const ready = S.loaded[tabKey()];
  const body = !ready ? loadingHtml() : { buyurtmalar: viewAdminOrders, mahsulotlar: viewAdminProducts, ombor: viewStock, hisobotlar: viewReports, mijozlar: viewAdminCustomers, chat: viewAdminChat }[ui.adminTab]();
  return `<header class="top admin">${header(S.me, 'admin')}${navHtml('adminTab', ui.adminTab, tabs)}</header>
    <main class="wrap ${ui.adminTab === 'chat' ? 'chat-page' : ''}">${body}</main>`;
}

const ORDER_FILTERS = [['faol', 'Faol'], ['yangi', 'Yangi'], ['yigilmoqda', "Yig'ilmoqda"], ['yolda', "Yo'lda"], ['yetkazildi', 'Yetkazildi'], ['bekor', 'Bekor qilingan'], ['hammasi', 'Hammasi']];
function viewAdminOrders() {
  const { orders, counts, total, today } = S.adm;
  return `<div class="sec-head"><h2>Buyurtmalar</h2><span class="muted small">Bugun: ${today.count} ta buyurtma · ${money(today.sum)}</span></div>
    <div class="chips">${ORDER_FILTERS.map(([k, l]) => `<button class="chip ${ui.orderFilter === k ? 'on' : ''}" data-a="of" data-id="${k}">${l}<span class="cnt">${counts[k] ?? 0}</span></button>`).join('')}</div>
    ${orders.length ? `<div class="ogrid">${orders.map(orderCard).join('')}</div>` : empty('📭', "Bu bo'limda buyurtma yo'q")}
    ${total > orders.length ? `<div class="center" style="margin-top:16px"><button class="btn" data-a="more">Yana ko'rsatish (${total - orders.length})</button></div>` : ''}`;
}
function orderCard(o) {
  const c = o.customer || {};
  const names = o.items.slice(0, 3).map(i => `${i.name} × ${num(i.qty)}`).join(', ') + (o.items.length > 3 ? ` va yana ${o.items.length - 3} ta` : '');
  return `<div class="card ocard ${o.status === 'yangi' ? 'is-new' : ''}">
    <div class="o-head"><b>#${o.id}</b>${badge(o.status)}<span class="muted small right">${fmtDT(o.createdAt)}</span></div>
    <div class="ocust"><b>${esc(c.shop || c.name || '—')}</b>${c.shop ? ` · ${esc(c.name)}` : ''}<br>
      <a href="tel:+${esc(c.phone)}">${fmtPhone(c.phone)}</a> · <span class="muted">${esc(o.address)}</span></div>
    <div class="muted small">${esc(names)}</div>
    ${o.comment ? `<div class="ocomment">💬 ${esc(o.comment)}</div>` : ''}
    <div class="o-foot"><b>${money(o.total)}</b>
      <div class="row gap"><button class="btn sm" data-a="openOrder" data-id="${o.id}">Batafsil</button>
      ${NEXT[o.status] ? `<button class="btn sm primary" data-a="advance" data-id="${o.id}" data-st="${o.status}">${NEXT[o.status].label}</button>` : ''}</div></div>
  </div>`;
}
async function openOrder(id, silent) {
  id = Number(id);
  let o;
  try { o = (await api(`/orders/${id}`)).order; } catch (e) { if (!silent) fail(e); return; }
  S.orderCache.set(o.id, o);
  if (silent && (ui.openOrderId !== id || $('#modal').classList.contains('hidden'))) return;
  const c = o.customer || {};
  ui.openOrderId = id;
  openModal(`
    <div class="m-head"><h3>Buyurtma #${o.id}</h3>${badge(o.status)}<button class="x no-print" data-a="closeModal" aria-label="Yopish">✕</button></div>
    <div class="m-grid">
      <div><div class="muted small">Mijoz</div><b>${esc(c.shop || c.name)}</b><div>${esc(c.name)}</div><a href="tel:+${esc(c.phone)}">${fmtPhone(c.phone)}</a></div>
      <div><div class="muted small">Yetkazish manzili</div>${esc(o.address)}
        <div class="muted small" style="margin-top:8px">Buyurtma vaqti</div>${fmtDT(o.createdAt)}</div>
    </div>
    ${o.comment ? `<div class="ocomment" style="margin-bottom:12px">💬 ${esc(o.comment)}</div>` : ''}
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="hide-m">#</th><th>Mahsulot</th><th class="r">Miqdor</th><th class="r hide-m">Narx</th><th class="r">Summa</th><th class="print-only">✓</th></tr></thead>
      <tbody>${o.items.map((i, k) => `<tr><td class="hide-m">${k + 1}</td><td>${esc(i.name)}<div class="muted small m-only">${money(i.price)} / ${esc(i.unit)}</div></td><td class="r nowrap">${num(i.qty)} ${esc(i.unit)}</td><td class="r nowrap hide-m">${money(i.price)}</td><td class="r nowrap">${money(i.sum)}</td><td class="print-only">☐</td></tr>`).join('')}</tbody>
      <tfoot><tr><td class="hide-m"></td><td>Jami</td><td></td><td class="hide-m"></td><td class="r nowrap">${money(o.total)}</td><td class="print-only"></td></tr></tfoot>
    </table></div>
    <div class="timeline">${(o.history || []).map(h => `${STATUS[h.status]?.label || h.status}: ${fmtDT(h.at)}`).join(' → ')}</div>
    <div class="m-actions no-print">
      ${ACTIVE.includes(o.status) ? `<button class="btn danger" data-a="cancelOrder" data-id="${o.id}">Bekor qilish</button>` : ''}
      <button class="btn" data-a="askOrder" data-id="${o.id}">Mijozga yozish</button>
      <button class="btn" data-a="printModal">🖨 Yig'ish varaqasi</button>
      ${NEXT[o.status] ? `<button class="btn primary" data-a="advance" data-id="${o.id}" data-st="${o.status}">${NEXT[o.status].label}</button>` : ''}
    </div>`);
}
async function changeStatus(id, status) {
  await api(`/orders/${id}/status`, { method: 'POST', body: { status } });
  toast(`#${id}: ${STATUS[status].label}`);
  await refresh();
  if (ui.openOrderId === Number(id) && !$('#modal').classList.contains('hidden')) openOrder(id, true);
}

/* Mahsulotlar */
function viewAdminProducts() {
  return `<div class="sec-head"><h2>Mahsulotlar <span class="muted" style="font-weight:400">(${S.products.length})</span></h2>
      <button class="btn primary" data-a="newProduct">+ Mahsulot qo'shish</button></div>
    ${S.products.length ? `<div class="card flush tbl-wrap"><table class="tbl">
      <thead><tr><th>Rasm</th><th>Nomi</th><th class="hide-m">Kategoriya</th><th class="hide-m">Birlik</th><th class="r hide-m">Narx</th><th class="r hide-m">Omborda</th><th class="hide-m">Holat</th><th></th></tr></thead>
      <tbody>${S.products.map(p => `<tr class="${p.active ? '' : 'dim'}">
        <td class="thumb"><div class="thumb-box">${photoHtml(p)}</div></td>
        <td><b>${esc(p.name)}</b><div class="muted small m-only">${esc(p.category)}${p.active ? '' : ' · Yashirin'}</div><div class="m-only"><b>${money(p.price)}</b> <span class="muted small">/ ${esc(p.unit)}</span></div><div class="m-only small">Omborda: ${stockHtml(p)}</div></td>
        <td class="hide-m">${esc(p.category)}</td><td class="hide-m">${esc(p.unit)}</td>
        <td class="r nowrap hide-m">${money(p.price)}</td>
        <td class="r nowrap hide-m">${stockHtml(p)}</td>
        <td class="hide-m">${p.active ? '<span class="pill ok">Sotuvda</span>' : '<span class="pill">Yashirin</span>'}</td>
        <td class="r"><div class="acts"><button class="btn sm" data-a="editProduct" data-id="${p.id}">Tahrirlash</button>
          <button class="btn sm" data-a="toggleProduct" data-id="${p.id}">${p.active ? 'Yashirish' : "Sotuvga qo'yish"}</button></div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card">${empty('📦', "Hali mahsulot yo'q. \"+ Mahsulot qo'shish\" tugmasini bosing.")}</div>`}`;
}

/* Ombor — qoldiq har doim donada sanaladi (mahsulot kg yoki litrda sotilsa ham) */
const SU = 'dona';
const stockHtml = p => p.stock == null ? '<span class="pill">Kiritilmagan</span>'
  : p.stock <= 0 ? `<span class="pill bad">Tugagan · 0 ${SU}</span>`
  : `<b>${num(p.stock)}</b> ${SU}`;
function viewStock() {
  const list = [...S.products].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const out = list.filter(p => p.stock != null && p.stock <= 0).length;
  const unset = list.filter(p => p.stock == null).length;
  return `<div class="sec-head"><h2>Ombor <span class="muted" style="font-weight:400">(${list.length})</span></h2>
      <span class="muted small">${out ? `<span class="pill bad">Tugagan: ${out}</span> ` : ''}${unset ? `<span class="pill">Qoldig'i kiritilmagan: ${unset}</span>` : ''}</span></div>
    <p class="muted small" style="margin:-4px 0 12px">Mijoz buyurtma berganda mahsulot ombordan avtomatik ayiriladi, buyurtma bekor qilinsa qaytariladi.</p>
    ${list.length ? `<div class="card flush tbl-wrap"><table class="tbl">
      <thead><tr><th>Mahsulot</th><th class="hide-m">Kategoriya</th><th class="r">Omborda</th><th></th></tr></thead>
      <tbody>${list.map(p => `<tr class="${p.active ? '' : 'dim'}">
        <td><b>${esc(p.name)}</b><div class="muted small m-only">${esc(p.category)}</div>${p.active ? '' : '<div class="muted small">Yashirin</div>'}</td>
        <td class="hide-m">${esc(p.category)}</td>
        <td class="r nowrap">${stockHtml(p)}</td>
        <td class="r"><div class="acts"><button class="btn sm primary" data-a="stockIn" data-id="${p.id}">+ Kirim</button>
          <button class="btn sm" data-a="stockSet" data-id="${p.id}">Tuzatish</button></div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card">${empty('🏬', "Omborda hali mahsulot yo'q. Avval \"Mahsulotlar\" bo'limida mahsulot qo'shing.")}</div>`}`;
}
// mode: 'in' — kirim (nechta keldi), 'set' — aniq qoldiqni yozish (sanoqdan keyin)
function stockForm(p, mode) {
  ui.openOrderId = null;
  const now = p.stock == null ? 'kiritilmagan' : `${num(p.stock)} ${SU}`;
  openModal(`<form data-form="saveStock" data-id="${p.id}" data-mode="${mode}">
    <div class="m-head"><h3>${mode === 'in' ? 'Omborga kirim' : 'Qoldiqni tuzatish'}</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
    <p style="margin:0 0 12px"><b>${esc(p.name)}</b><br><span class="muted">Hozir omborda: ${now}</span></p>
    <label>${mode === 'in' ? `Nechta keldi? (${SU}) *` : `Omborda aniq nechta bor? (${SU}) *`}
      <input name="qty" type="number" min="${mode === 'in' ? '1' : '0'}" step="1" required inputmode="numeric" pattern="[0-9]*" value="${mode === 'set' && p.stock != null ? p.stock : ''}" placeholder="0"></label>
    <div class="m-actions"><button type="button" class="btn" data-a="closeModal">Bekor</button><button class="btn primary">Saqlash</button></div></form>`);
  setTimeout(() => { const i = $('#modalBox input[name=qty]'); i?.focus(); i?.select(); }, 30);
}
function updatePhotoUI() {
  const box = $('#photoDrop'); if (!box) return;
  box.classList.toggle('has', !!ui.formPhoto);
  box.innerHTML = ui.formPhoto ? `<img src="${esc(ui.formPhoto)}" alt="">` : `${IMG_ICON}<span>Rasm yuklash</span>`;
  $('#pickBtn').textContent = ui.formPhoto ? 'Rasmni almashtirish' : 'Rasm tanlash';
  $('#rmPhotoBtn').hidden = !ui.formPhoto;
}
// Rasmni kichraytirib (eng katta tomoni 1000px), JPEG ko'rinishida olamiz
function readPhoto(file, max = 1000) {
  return new Promise((res, rej) => {
    if (!file || !file.type.startsWith('image/')) return rej(new Error('type'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('load')); };
    img.src = url;
  });
}
function handlePhoto(file) {
  readPhoto(file).then(d => { ui.formPhoto = d; updatePhotoUI(); }).catch(() => toast("Rasmni o'qib bo'lmadi. JPG yoki PNG fayl tanlang."));
}
function productForm(p) {
  ui.openOrderId = null;
  ui.formPhoto = ui.formPhotoOrig = p?.photo || '';
  const cats = [...new Set(S.products.map(x => x.category))];
  const units = S.units.length ? S.units : ['dona', 'kg', 'qop', 'quti', 'blok', 'pachka', 'litr', 'metr'];
  openModal(`<form data-form="saveProduct" data-id="${p ? p.id : ''}">
    <div class="m-head"><h3>${p ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'}</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
    <div class="flabel">Mahsulot rasmi</div>
    <div class="photo-field">
      <div class="photo-prev" id="photoDrop" data-a="pickPhoto" title="Bosing yoki rasmni shu yerga tashlang"></div>
      <div>
        <div class="photo-btns">
          <button type="button" class="btn sm" id="pickBtn" data-a="pickPhoto">Rasm tanlash</button>
          <button type="button" class="btn sm danger" id="rmPhotoBtn" data-a="rmPhoto">Olib tashlash</button>
        </div>
        <p class="muted small" style="margin:8px 0 0">JPG yoki PNG. Katta rasm avtomatik kichraytiriladi.</p>
        <input type="file" id="photoInput" accept="image/*" hidden>
      </div>
    </div>
    <label>Nomi *<input name="name" required maxlength="120" value="${esc(p?.name)}" placeholder="Masalan: Un oliy nav 50 kg"></label>
    <label>Kategoriya *<input name="category" list="catList" required maxlength="60" value="${esc(p?.category)}" placeholder="Tanlang yoki yozing"></label>
    <datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="two">
      <label>O'lchov birligi<select name="unit">${units.map(u => `<option ${p?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      <label>Narx (so'm) *<input name="price" type="number" min="1" step="1" required value="${p ? p.price : ''}" placeholder="0"></label>
    </div>
    ${!p || p.stock == null
      ? `<label>Omborda nechta bor? (${SU}) *<input name="stock" type="number" min="0" step="1" required inputmode="numeric" pattern="[0-9]*" placeholder="Masalan: 10">
          <span class="muted small" style="font-weight:400">O'lchov birligida: 10 qop, 25 kg va hokazo.</span></label>`
      : `<p class="muted small" style="margin:0 0 12px">Omborda: <b>${num(p.stock)} ${SU}</b>. Qoldiq "Ombor" bo'limida o'zgartiriladi.</p>`}
    <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Sotuvda (mijozlarga ko'rinadi)</label>
    <div class="m-actions">
      ${p ? `<button type="button" class="btn danger" data-a="delProduct" data-id="${p.id}" style="margin-right:auto">O'chirish</button>` : ''}
      <button type="button" class="btn" data-a="closeModal">Bekor</button>
      <button class="btn primary">Saqlash</button>
    </div></form>`);
  updatePhotoUI();
  setTimeout(() => $('#modalBox input[name=name]')?.focus(), 30);
}

/* Hisobotlar */
function period() {
  const [y, m, d] = ui.rDate.split('-').map(Number);
  let from, to, label;
  if (ui.rType === 'kunlik') { from = new Date(y, m - 1, d); to = new Date(y, m - 1, d + 1); label = `${fmtDate(from)}, ${WD_FULL[from.getDay()]}`; }
  else if (ui.rType === 'haftalik') { const wd = (new Date(y, m - 1, d).getDay() + 6) % 7; from = new Date(y, m - 1, d - wd); to = new Date(y, m - 1, d - wd + 7); label = `${fmtDate(from)} – ${fmtDate(new Date(y, m - 1, d - wd + 6))}`; }
  else { from = new Date(y, m - 1, 1); to = new Date(y, m, 1); label = `${MONTHS[m - 1]} ${y}`; }
  return { from: from.getTime(), to: to.getTime(), label };
}
const TYPE_LABEL = { kunlik: 'Kunlik', haftalik: 'Haftalik', oylik: 'Oylik' };
// Hisobotlar sarlavhasi va davr tanlash (savdo va ombor hisobi uchun umumiy)
function reportHead() {
  const types = [['kunlik', 'Kunlik'], ['haftalik', 'Haftalik'], ['oylik', 'Oylik']];
  const stock = ui.rView === 'ombor';
  return `<div class="sec-head"><h2>${stock ? 'Ombor hisobi' : 'Hisobotlar'}</h2>
      <div class="row gap no-print head-btns">${stock
        ? '<button class="btn" data-a="rView" data-id="savdo">📊 Savdo hisoboti</button>'
        : '<button class="btn" data-a="rView" data-id="ombor">🏬 Ombor hisobi</button>'}
        <button class="btn" data-a="exportCsv">⬇ Excel (CSV)</button><button class="btn" data-a="print">🖨 Chop etish</button></div></div>
    <div class="card rep-ctl no-print">
      <div class="seg">${types.map(([k, l]) => `<button data-a="rType" data-id="${k}" class="${ui.rType === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="row gap"><button class="btn sm" data-a="rShift" data-id="-1" aria-label="Oldingi">‹</button>
        <input type="date" id="rDate" value="${ui.rDate}" aria-label="Sana"><button class="btn sm" data-a="rShift" data-id="1" aria-label="Keyingi">›</button>
        <button class="btn sm" data-a="rToday">Bugun</button></div>
      ${stock ? '' : `<select id="rBasis" aria-label="Qaysi buyurtmalar hisoblansin"><option value="yetkazildi" ${ui.rBasis === 'yetkazildi' ? 'selected' : ''}>Faqat yetkazilganlar</option>
        <option value="barcha" ${ui.rBasis === 'barcha' ? 'selected' : ''}>Barcha buyurtmalar (bekorlardan tashqari)</option></select>`}
    </div>`;
}
const MOVE_LABEL = {
  boshlangich: "Boshlang'ich qoldiq", kirim: 'Kirim', chiqim: 'Chiqim', tuzatish: 'Sanoq (tuzatish)', buyurtma: 'Buyurtma', qaytdi: 'Bekor qilindi, qaytdi',
};
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n));
const sgnCls = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
function viewStockReport() {
  const r = S.stockRep;
  if (!r) return loadingHtml();
  const ins = r.moves.filter(m => m.qty > 0).length, outs = r.moves.filter(m => m.qty < 0).length;
  const ordersOut = new Set(r.moves.filter(m => m.kind === 'buyurtma').map(m => m.orderId)).size;
  const note = r.untracked ? `<p class="note">ℹ️ ${r.untracked} ta mahsulotning ombordagi miqdori hali kiritilmagan, ular hisobga kirmaydi. "Ombor" bo'limida "Tuzatish" orqali kiriting.</p>` : '';
  return `${reportHead()}
    <h3 class="period">${TYPE_LABEL[ui.rType]} ombor hisobi: ${r.label}</h3>
    <div class="kpis">
      <div class="kpi"><span>Mahsulot turlari</span><b>${r.products.length}</b></div>
      <div class="kpi"><span>Kirim yozuvlari</span><b>${ins}</b></div>
      <div class="kpi"><span>Chiqim yozuvlari</span><b>${outs}</b></div>
      <div class="kpi total"><span>Buyurtma bilan chiqdi</span><b>${ordersOut} ta</b></div>
    </div>
    ${note}
    ${r.products.length ? `<div class="stack">
      <div class="card flush tbl-wrap"><h3>Mahsulotlar bo'yicha</h3><table class="tbl">
        <thead><tr><th>Mahsulot</th><th class="r hide-m">Davr boshida</th><th class="r">Kirdi</th><th class="r">Chiqdi</th><th class="r">Qoldi</th></tr></thead>
        <tbody>${r.products.map(p => `<tr class="${p.deleted ? 'dim' : ''}"><td><b>${esc(p.name)}</b>${p.deleted ? ` <span class="muted small">(o'chirilgan)</span>` : ''}
            <div class="muted small m-only">Boshida: ${num(p.start)} ${SU}</div></td>
          <td class="r nowrap hide-m">${num(p.start)} ${SU}</td>
          <td class="r nowrap">${p.in ? `<span class="pos">+${num(p.in)}</span>` : '—'}</td>
          <td class="r nowrap">${p.out ? `<span class="neg">−${num(p.out)}</span>` : '—'}</td>
          <td class="r nowrap"><b>${num(p.end)} ${SU}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="card flush tbl-wrap"><h3>Harakatlar tarixi <span class="muted" style="font-weight:400">(${r.moves.length})</span></h3>${r.moves.length ? `<table class="tbl">
        <thead><tr><th>${ui.rType === 'kunlik' ? 'Vaqt' : 'Sana'}</th><th>Mahsulot</th><th class="hide-m">Harakat</th><th class="r">Miqdor</th><th class="r hide-m">Qoldi</th><th class="hide-m">Kim</th></tr></thead>
        <tbody>${r.moves.map(m => {
          const what = `${MOVE_LABEL[m.kind] || esc(m.kind)}${m.orderId ? ` <a href="#" data-a="openOrder" data-id="${m.orderId}">#${m.orderId}</a>` : ''}`;
          return `<tr><td class="nowrap">${ui.rType === 'kunlik' ? fmtTime(m.at) : fmtDT(m.at)}</td>
            <td>${esc(m.name)}<div class="muted small m-only">${what}${m.by ? ' · ' + esc(m.by) : ''}</div></td>
            <td class="hide-m">${what}</td>
            <td class="r nowrap"><span class="${sgnCls(m.qty)}">${signed(m.qty)}</span> ${SU}</td>
            <td class="r nowrap hide-m">${num(m.after)} ${SU}</td><td class="hide-m">${esc(m.by)}</td></tr>`;
        }).join('')}</tbody></table>` : `<p class="muted" style="padding:0 16px 16px">Bu davrda omborga hech narsa kirmadi va chiqmadi.</p>`}</div>
    </div>` : `<div class="card">${empty('🏬', "Ombor hisobi uchun mahsulot yo'q. Avval mahsulot qo'shib, ombordagi miqdorini kiriting.")}</div>`}`;
}
function viewReports() {
  if (ui.rView === 'ombor') return viewStockReport();
  const r = S.report;
  if (!r) return loadingHtml();
  const base = new Date(r.from);
  const series = ui.rType === 'kunlik' ? [] : r.series.map((sum, i) => {
    const dd = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    return { day: dd.getTime(), sum, label: ui.rType === 'haftalik' ? `${WD[dd.getDay()]} ${dd.getDate()}` : String(dd.getDate()) };
  });
  const max = Math.max(1, ...series.map(x => x.sum));
  const chart = series.length ? `<div class="card"><h3>Kunlar bo'yicha savdo</h3><div class="chart ${ui.rType}">${series.map(x =>
      `<div class="bar-col" title="${fmtDate(x.day)}: ${money(x.sum)}"><div class="bar-val">${x.sum ? shortMoney(x.sum) : ''}</div>
       <div class="bar-area"><div class="cbar ${x.sum ? '' : 'zero'}" style="height:${x.sum / max * 100}%"></div></div><div class="bar-lbl">${x.label}</div></div>`).join('')}</div></div>` : '';
  const dayList = ui.rType === 'kunlik' && r.orders.length ? `<div class="card flush tbl-wrap"><h3>Shu kungi buyurtmalar</h3><table class="tbl">
      <thead><tr><th>№</th><th class="hide-m">Vaqt</th><th>Mijoz</th><th class="hide-m">Holat</th><th class="r">Summa</th></tr></thead>
      <tbody>${r.orders.map(o => `<tr><td><a href="#" data-a="openOrder" data-id="${o.id}">#${o.id}</a></td><td class="hide-m">${fmtTime(o.createdAt)}</td><td>${esc(o.customer.shop || o.customer.name)}<div class="muted small m-only">${fmtTime(o.createdAt)}</div></td><td class="hide-m">${badge(o.status)}</td><td class="r nowrap">${money(o.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>ITOGO</td><td class="hide-m"></td><td></td><td class="hide-m"></td><td class="r nowrap">${money(r.total)}</td></tr></tfoot></table></div>` : '';
  const note = r.notCounted ? `<p class="note">ℹ️ ${ui.rBasis === 'yetkazildi' ? 'Hali yetkazilmagan yoki bekor qilingan' : 'Bekor qilingan'} ${r.notCounted} ta buyurtma hisobotga kirmadi.</p>` : '';
  return `${reportHead()}
    <h3 class="period">${TYPE_LABEL[ui.rType]} hisobot: ${r.label}</h3>
    <div class="kpis">
      <div class="kpi"><span>Buyurtmalar</span><b>${r.count}</b></div>
      <div class="kpi"><span>Mijozlar</span><b>${r.customers.length}</b></div>
      <div class="kpi"><span>Mahsulot turlari</span><b>${r.products.length}</b></div>
      <div class="kpi total"><span>ITOGO</span><b>${money(r.total)}</b></div>
    </div>
    ${note}
    ${r.count ? `<div class="stack">
      ${chart}
      <div class="card flush tbl-wrap"><h3>Nima qancha sotildi</h3><table class="tbl">
        <thead><tr><th class="hide-m">#</th><th>Mahsulot</th><th class="r">Miqdor</th><th class="r">Summa</th><th class="r hide-m">Ulush</th></tr></thead>
        <tbody>${r.products.map((p, i) => `<tr><td class="hide-m">${i + 1}</td><td>${esc(p.name)}</td><td class="r nowrap">${num(p.qty)} ${esc(p.unit)}</td><td class="r nowrap">${money(p.sum)}</td><td class="r hide-m">${Math.round(p.sum / r.total * 100)}%</td></tr>`).join('')}</tbody>
        <tfoot><tr><td class="hide-m"></td><td>ITOGO</td><td></td><td class="r nowrap">${money(r.total)}</td><td class="r hide-m">100%</td></tr></tfoot></table></div>
      <div class="card flush tbl-wrap"><h3>Mijozlar bo'yicha</h3><table class="tbl">
        <thead><tr><th>Mijoz</th><th class="hide-m">Telefon</th><th class="r">Buyurtma</th><th class="r">Summa</th></tr></thead>
        <tbody>${r.customers.map(x => `<tr><td><b>${esc(x.shop || x.name)}</b><div class="muted small">${esc(x.name)}</div></td><td class="nowrap hide-m">${fmtPhone(x.phone)}</td><td class="r">${x.orders}</td><td class="r nowrap">${money(x.sum)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>ITOGO</td><td class="hide-m"></td><td class="r">${r.count}</td><td class="r nowrap">${money(r.total)}</td></tr></tfoot></table></div>
      ${dayList}
    </div>` : `<div class="card">${empty('📊', "Bu davrda hisobga kiradigan savdo yo'q")}</div>`}`;
}

/* Mijozlar */
function viewAdminCustomers() {
  const L = S.custLimit || { used: 0, max: null };
  const full = L.max !== null && L.used >= L.max;
  const limitTxt = L.max === null ? `Siz qo'shgan mijozlar: ${L.used} ta` : `Siz qo'shgan mijozlar: <b>${L.used} / ${L.max}</b>${full ? ' — limit to\'ldi' : ''}`;
  const head = `<div class="sec-head"><h2>Mijozlar <span class="muted" style="font-weight:400">(${S.customers.length})</span></h2>
      <button class="btn primary" data-a="newCustomer" ${full ? `disabled title="Limit to'ldi. Super admin bilan bog'laning."` : ''}>+ Mijoz qo'shish</button></div>
    <p class="note">${limitTxt}. Mijoz siz kiritgan telefon raqam va parol bilan kirish sahifasidan kiradi.${full ? " Ko'proq mijoz qo'shish uchun super admin bilan bog'laning." : ''}</p>`;
  if (!S.customers.length) return `${head}<div class="card">${empty('👥', "Hali mijoz yo'q. \"+ Mijoz qo'shish\" tugmasini bosing.")}</div>`;
  return `${head}
    <div class="card flush tbl-wrap"><table class="tbl">
      <thead><tr><th>Mijoz</th><th class="hide-m">Telefon</th><th class="hide-m">Manzil</th><th class="r hide-m">Buyurtma</th><th class="r">Jami summa</th><th class="hide-m">Oxirgi buyurtma</th><th class="hide-m">Qo'shilgan</th><th></th></tr></thead>
      <tbody>${S.customers.map(c => `<tr><td><b>${esc(c.shop || c.name)}</b><div class="muted small">${esc(c.name)}</div>
          <div class="small m-only"><a href="tel:+${esc(c.phone)}">${fmtPhone(c.phone)}</a> · ${c.orders} ta buyurtma</div></td>
        <td class="nowrap hide-m"><a href="tel:+${esc(c.phone)}">${fmtPhone(c.phone)}</a></td><td class="hide-m">${esc(c.address)}</td>
        <td class="r hide-m">${c.orders}</td><td class="r nowrap">${money(c.sum)}</td><td class="nowrap hide-m">${c.lastOrderAt ? fmtDate(c.lastOrderAt) : '—'}</td>
        <td class="nowrap hide-m">${fmtDate(c.createdAt)}<div class="muted small">${c.mine ? 'siz' : c.addedBy ? esc(c.addedBy) : "o'zi ro'yxatdan o'tgan"}</div></td>
        <td class="r"><div class="acts"><button class="btn sm" data-a="chatWith" data-id="${c.id}">Yozish</button><button class="btn sm" data-a="editCustomer" data-id="${c.id}">Tahrirlash</button><button class="btn sm" data-a="resetPw" data-id="${c.id}">Parol</button><button class="btn sm danger" data-a="delCustomer" data-id="${c.id}">O'chirish</button></div></td></tr>`).join('')}</tbody>
    </table></div>`;
}
function customerForm(c) {
  openModal(`<form data-form="saveCustomer" data-id="${c ? c.id : ''}">
    <div class="m-head"><h3>${c ? 'Mijozni tahrirlash' : 'Yangi mijoz'}</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
    <label>Ism familiya *<input name="name" required maxlength="80" value="${esc(c?.name)}" placeholder="Masalan: Azizbek Karimov"></label>
    <label>Do'kon / firma nomi<input name="shop" maxlength="100" value="${esc(c?.shop)}" placeholder="Masalan: Baraka do'koni"></label>
    <label>Telefon raqam (kirish uchun) *<div class="phone"><span>+998</span><input name="phone" inputmode="numeric" placeholder="90 123 45 67" data-phone required value="${c ? fmtLocal(String(c.phone).slice(3)) : ''}"></div></label>
    <label>Yetkazib berish manzili *<input name="address" required maxlength="300" value="${esc(c?.address)}" placeholder="Tuman, ko'cha, uy"></label>
    ${c ? '' : `${pwField('Parol *', 6)}<p class="muted small" style="margin-top:-6px">Parol avtomatik yaratildi, xohlasangiz o'zgartiring. Telefon raqam va parolni mijozga ayting.</p>`}
    <div class="m-actions"><button type="button" class="btn" data-a="closeModal">Bekor</button><button class="btn primary">${c ? 'Saqlash' : "Mijozni qo'shish"}</button></div>
  </form>`);
  setTimeout(() => $('#modalBox input[name=name]')?.focus(), 30);
}
function resetPwForm(c) {
  openModal(`<form data-form="resetPw" data-id="${c.id}">
    <div class="m-head"><h3>Yangi parol qo'yish</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
    <p style="margin-top:0"><b>${esc(c.shop || c.name)}</b> · ${fmtPhone(c.phone)}</p>
    <p class="muted small">Mijoz parolini unutgan bo'lsa, yangi parol qo'ying va unga ayting. Mijoz keyin profilida o'zgartirishi mumkin.</p>
    ${pwField('Yangi parol', 6)}
    <div class="m-actions"><button type="button" class="btn" data-a="closeModal">Bekor</button><button class="btn primary">Saqlash</button></div>
  </form>`);
}

/* ---------- Super admin paneli: faqat admin hisoblari ---------- */
function viewSuper() {
  const list = S.admins;
  const body = !S.loaded[tabKey()] ? loadingHtml() : `
    <div class="sec-head"><h2>Admin hisoblari <span class="muted" style="font-weight:400">(${list.length})</span></h2>
      <button class="btn primary" data-a="newAdmin">+ Admin qo'shish</button></div>
    <p class="note">Adminlar asosiy sahifada telefon raqami va parol bilan kiradi. Mijozlarni admin qo'shadi: "Mijozlar" ustunida admin nechta qo'shgani va unga belgilangan limit ko'rinadi (∞ — limit qo'yilmagan, "Tahrirlash" orqali belgilang). Bloklangan admin tizimga kira olmaydi, uning ochiq turgan oynalari ham darhol yopiladi.</p>
    ${list.length ? `<div class="card flush tbl-wrap"><table class="tbl">
      <thead><tr><th>Admin</th><th class="hide-m">Telefon (login)</th><th class="r">Mijozlar</th><th>Holat</th><th class="hide-m">Yaratilgan</th><th class="hide-m">Oxirgi kirish</th><th></th></tr></thead>
      <tbody>${list.map(a => `<tr class="${a.active ? '' : 'dim'}">
        <td><b>${esc(a.name)}</b><div class="small m-only">${fmtPhone(a.phone)}</div><div class="muted small m-only">Oxirgi kirish: ${a.lastLoginAt ? fmtDT(a.lastLoginAt) : '—'}</div></td>
        <td class="nowrap hide-m">${fmtPhone(a.phone)}</td>
        <td class="r nowrap" title="Qo'shgan / ruxsat etilgan">${a.customersAdded} / ${a.customerLimit ?? '∞'}</td>
        <td>${a.active ? '<span class="pill ok">Faol</span>' : '<span class="pill off">Bloklangan</span>'}</td>
        <td class="nowrap hide-m">${fmtDate(a.createdAt)}</td>
        <td class="nowrap hide-m">${a.lastLoginAt ? fmtDT(a.lastLoginAt) : '—'}</td>
        <td class="r"><div class="acts">
          <button class="btn sm" data-a="editAdmin" data-id="${a.id}">Tahrirlash</button>
          <button class="btn sm" data-a="adminPw" data-id="${a.id}">Parol</button>
          <button class="btn sm" data-a="toggleAdmin" data-id="${a.id}">${a.active ? 'Bloklash' : 'Faollashtirish'}</button>
          <button class="btn sm danger" data-a="delAdmin" data-id="${a.id}">O'chirish</button></div></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="card">${empty('🛡️', "Hali admin yo'q. \"+ Admin qo'shish\" tugmasini bosing.")}</div>`}`;
  return `<header class="top admin super">${header(S.me, 'super')}</header><main class="wrap">${body}</main>`;
}
function genPassword(n = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return [...a].map(x => abc[x % abc.length]).join('');
}
const pwField = (label, minlength) => `<label>${label}<div class="pw-row"><input name="password" type="text" required minlength="${minlength}" maxlength="200" autocomplete="off" spellcheck="false" value="${genPassword()}"><button type="button" class="btn sm" data-a="genPw">Boshqasi</button></div></label>`;
function adminForm(a) {
  openModal(`<form data-form="saveAdmin" data-id="${a ? a.id : ''}">
    <div class="m-head"><h3>${a ? 'Adminni tahrirlash' : 'Yangi admin'}</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
    <label>Ism familiya *<input name="name" required maxlength="80" value="${esc(a?.name)}" placeholder="Masalan: Jasur Aliyev"></label>
    <label>Telefon raqam (kirish uchun) *<div class="phone"><span>+998</span><input name="phone" inputmode="numeric" placeholder="90 123 45 67" data-phone required value="${a ? fmtLocal(String(a.phone).slice(3)) : ''}"></div></label>
    <label>Nechta mijoz qo'sha oladi? *<input name="customerLimit" type="number" min="0" max="100000" step="1" required inputmode="numeric" value="${a?.customerLimit ?? ''}" placeholder="Masalan: 50">
      <span class="muted small" style="font-weight:400">${a ? `Hozir qo'shgan: ${a.customersAdded} ta. ` : ''}Admin shu songacha mijoz qo'sha oladi.</span></label>
    ${a ? '' : `${pwField('Parol *', 8)}<p class="muted small" style="margin-top:-6px">Parol avtomatik yaratildi, xohlasangiz o'zgartiring. Uni adminga ayting: admin keyin "Profil"da o'zgartira oladi.</p>`}
    <div class="m-actions"><button type="button" class="btn" data-a="closeModal">Bekor</button><button class="btn primary">${a ? 'Saqlash' : 'Admin yaratish'}</button></div>
  </form>`);
  setTimeout(() => $('#modalBox input[name=name]')?.focus(), 30);
}
function adminPwForm(a) {
  openModal(`<form data-form="adminPw" data-id="${a.id}">
    <div class="m-head"><h3>Admin parolini tiklash</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
    <p style="margin-top:0"><b>${esc(a.name)}</b> · ${fmtPhone(a.phone)}</p>
    ${pwField('Yangi parol', 8)}
    <p class="muted small" style="margin-top:-6px">Saqlangandan keyin admin barcha qurilmalardan chiqariladi va yangi parol bilan kiradi.</p>
    <div class="m-actions"><button type="button" class="btn" data-a="closeModal">Bekor</button><button class="btn primary">Saqlash</button></div>
  </form>`);
}

/* ---------- Profil ---------- */
function profileForm() {
  const u = S.me, cust = !isAdmin();
  openModal(`<form data-form="saveProfile">
      <div class="m-head"><h3>Profil</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
      <label>Ism familiya<input name="name" value="${esc(u.name)}" required maxlength="80"></label>
      ${cust ? `<label>Do'kon / firma nomi<input name="shop" value="${esc(u.shop)}" maxlength="100"></label>
      <label>Yetkazib berish manzili<input name="address" value="${esc(u.address)}" required maxlength="300"></label>` : ''}
      <p class="muted small" style="margin-top:0">${isSuper() ? `Login: ${esc(u.login)}` : `Telefon: ${fmtPhone(u.phone)}`}</p>
      <div class="m-actions"><button class="btn primary">Saqlash</button></div>
    </form>
    ${pwChangeForm(cust ? 6 : 8)}`);
}
const pwChangeForm = (min, head = '<h3>Parolni almashtirish</h3>') => `
    <form data-form="changePassword" class="pw-form">
      ${head}
      <label>Hozirgi parol<input name="current" type="password" autocomplete="current-password" required></label>
      <div class="two"><label>Yangi parol<input name="next" type="password" autocomplete="new-password" required minlength="${min}"></label>
      <label>Yangi parolni takrorlang<input name="next2" type="password" autocomplete="new-password" required></label></div>
      <p class="muted small" style="margin-top:0">Kamida ${min} belgi. Almashtirilgach boshqa qurilmalardagi kirishlar bekor qilinadi.</p>
      <div class="m-actions"><button class="btn primary">Parolni almashtirish</button></div>
    </form>`;
// Faqat parolni almashtirish oynasi (super admin panelidagi "🔑 Parol" tugmasi)
function passwordForm() {
  openModal(pwChangeForm(8, `<div class="m-head"><h3>Parolni almashtirish</h3><button type="button" class="x" data-a="closeModal" aria-label="Yopish">✕</button></div>
      <p class="muted small" style="margin-top:0">Login: ${esc(S.me.login || '')}</p>`));
}

/* ---------- Chat ---------- */
function dayLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0); const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / DAY);
  return diff === 0 ? 'Bugun' : diff === 1 ? 'Kecha' : fmtDate(ts);
}
const shortTime = ts => { const l = dayLabel(ts); return l === 'Bugun' ? fmtTime(ts) : l === 'Kecha' ? 'Kecha' : fmtDate(ts).slice(0, 5); };
const initials = c => (c.shop || c.name || '?').replace(/["'«»“”]/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
function chatThread(me) {
  const msgs = S.thread.messages;
  if (!msgs.length) return `<div class="chat-empty">${me === 'customer' ? "Savolingiz bo'lsa yozing — admin javob beradi." : "Hali xabar yo'q. Birinchi bo'lib yozing."}</div>`;
  let lastDay = '';
  return msgs.map(m => {
    const day = dayLabel(m.createdAt), sep = day !== lastDay ? `<div class="day-sep"><span>${day}</span></div>` : ''; lastDay = day;
    const mine = m.sender === me;
    return `${sep}<div class="msg ${mine ? 'mine' : ''}"><div class="bubble">
      ${m.photo ? `<img class="msg-img" src="${esc(m.photo)}" alt="Rasm" data-a="viewImg" data-id="${esc(m.photo)}" loading="lazy">` : ''}
      ${m.text ? `<div class="mtext">${esc(m.text)}</div>` : ''}
      <div class="mmeta">${fmtTime(m.createdAt)}${mine ? `<span class="tick ${m.readAt ? 'read' : ''}" title="${m.readAt ? "O'qildi" : 'Yuborildi'}">${m.readAt ? '✓✓' : '✓'}</span>` : ''}</div></div></div>`;
  }).join('');
}
const chatForm = cid => `<form class="chat-input" data-form="sendMsg" data-id="${cid}">
    <button type="button" class="icon-btn" data-a="attachPhoto" title="Rasm yuborish" aria-label="Rasm yuborish">${icon('clip')}</button>
    <textarea id="chatText" name="text" rows="1" maxlength="2000" placeholder="Xabar yozing..." data-draft="${cid}" aria-label="Xabar">${esc(ui.drafts[cid] || '')}</textarea>
    <button class="btn primary send" title="Yuborish" aria-label="Yuborish">${icon('send')}</button>
    <input type="file" id="chatPhoto" accept="image/*" hidden>
  </form>`;
function viewCustChat() {
  return `<div class="chat card" id="chatBox">
    <div class="chat-head"><div class="avatar adm">A</div><div class="ch-info"><b>${esc(S.cfg.appName)} admini</b><div class="muted small">Savol, taklif yoki buyurtma bo'yicha yozing</div></div></div>
    <div class="chat-body" id="chatBody" data-n="${S.thread.messages.length}">${chatThread('customer')}</div>
    ${chatForm(S.me.id)}
  </div>`;
}
function viewAdminChat() {
  const convs = S.convs.slice();
  const c = ui.chatWith && (S.customers.find(x => x.id === ui.chatWith) || convs.find(x => x.customer.id === ui.chatWith)?.customer);
  if (c && !convs.some(x => x.customer.id === c.id)) convs.unshift({ customer: c, last: null, unread: 0 });
  const list = convs.map(x => `<button class="conv ${ui.chatWith === x.customer.id ? 'on' : ''} ${x.unread ? 'unread' : ''}" data-a="chatWith" data-id="${x.customer.id}">
      <div class="avatar">${esc(initials(x.customer))}</div>
      <div class="conv-main"><div class="conv-top"><b>${esc(x.customer.shop || x.customer.name)}</b><span class="muted small">${x.last ? shortTime(x.last.at) : ''}</span></div>
        <div class="conv-last"><span>${x.last ? (x.last.sender === 'admin' ? 'Siz: ' : '') + esc(x.last.text || 'Rasm') : 'Yangi suhbat'}</span>${x.unread ? `<span class="badge red">${x.unread}</span>` : ''}</div></div>
    </button>`).join('');
  const threadReady = S.thread.cid === ui.chatWith;
  const thread = c ? `<div class="chat" id="chatBox">
      <div class="chat-head"><button class="icon-btn back" data-a="chatBack" aria-label="Orqaga">‹</button><div class="avatar">${esc(initials(c))}</div>
        <div class="ch-info"><b>${esc(c.shop || c.name)}</b><div class="muted small">${esc(c.name)} · <a href="tel:+${esc(c.phone)}">${fmtPhone(c.phone)}</a></div></div></div>
      <div class="chat-body" id="chatBody" data-n="${threadReady ? S.thread.messages.length : 0}">${threadReady ? chatThread('admin') : loadingHtml()}</div>
      ${chatForm(c.id)}
    </div>` : `<div class="chat chat-none"><div class="empty">Chap tomondan suhbatni tanlang</div></div>`;
  return `<div class="chat-wrap card flush ${c ? 'has-active' : ''}" id="chatWrap">
    <div class="conv-list">
      <div class="conv-tools"><select id="newChat" aria-label="Mijozga yozish"><option value="">+ Mijozga yozish...</option>${S.customers.map(x => `<option value="${x.id}">${esc(x.shop || x.name)} — ${esc(x.name)}</option>`).join('')}</select></div>
      ${list || `<div class="empty small">Hali xabarlar yo'q</div>`}
    </div>
    ${thread}
  </div>`;
}
// Chat oynasini ekran balandligiga moslaymiz va kerak bo'lsa pastga aylantiramiz
function fitChat(prev) {
  const el = $('#chatWrap') || $('#chatBox'); if (!el) return;
  const nav = $('.tabs'), navH = nav && getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0;
  const top = el.getBoundingClientRect().top + window.scrollY;
  el.style.height = Math.max(320, window.innerHeight - top - navH - 12) + 'px';
  const b = $('#chatBody'); if (!b) return;
  if (!prev || prev.atBottom || prev.n !== b.dataset.n) b.scrollTop = b.scrollHeight; else b.scrollTop = prev.top;
}
function autoGrow() { const t = $('#chatText'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight + 2) + 'px'; }
async function sendMessage(cid, text, photo) {
  text = (text || '').trim(); if (!text && !photo) return;
  const d = await api('/chat/messages', { method: 'POST', body: { customerId: isAdmin() ? cid : undefined, text, photo: photo || undefined } });
  if (!photo) ui.drafts[cid] = '';
  if (S.thread.cid === cid && !S.thread.messages.some(m => m.id === d.message.id)) S.thread.messages.push(d.message);
  render();
}

/* ---------- Modal, tasdiqlash, xabarnoma ---------- */
function openModal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; ui.openOrderId = null; }
function ask(msg, yes = 'Ha', danger = false) {
  return new Promise(res => {
    const d = $('#dlg'), y = $('#dlgYes'), n = $('#dlgNo');
    $('#dlgMsg').textContent = msg; y.textContent = yes; y.className = 'btn ' + (danger ? 'danger-fill' : 'primary');
    const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); done(false); } };
    const done = v => { d.classList.add('hidden'); y.onclick = n.onclick = d.onclick = null; document.removeEventListener('keydown', key, true); res(v); };
    y.onclick = () => done(true); n.onclick = () => done(false); d.onclick = e => { if (e.target === d) done(false); };
    document.addEventListener('keydown', key, true);
    d.classList.remove('hidden'); y.focus();
  });
}
function toast(msg, act = '', id = '') {
  const t = $('#toast'); t.textContent = msg; t.dataset.a = act; t.dataset.id = id; t.style.cursor = act ? 'pointer' : '';
  t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), act ? 6000 : 3500);
}
let audioCtx = null;
document.addEventListener('pointerdown', () => { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* */ } } }, { once: true });
function beep() {
  if (!audioCtx) return;
  try {
    audioCtx.resume?.();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination); o.frequency.value = 880; g.gain.value = 0.08; o.start(); o.stop(audioCtx.currentTime + 0.18);
  } catch { /* */ }
}

/* =====================================================================
   Amallar (tugmalar)
   ===================================================================== */
const go = (k, v) => { ui[k] = v; scrollTo(0, 0); render(); refresh(); };
const A = {
  reload: () => location.reload(),
  logout: async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* */ } onLoggedOut(); },
  profile: () => profileForm(),
  password: () => passwordForm(),
  custTab: id => go('custTab', id),
  adminTab: id => go('adminTab', id),
  cat: id => { ui.cat = id; render(); },
  add: id => setQty(id, 1),
  inc: id => setQty(id, (cart[id] || 0) + 1),
  dec: id => setQty(id, (cart[id] || 0) - 1),
  rm: id => setQty(id, 0),
  moreMy: () => { ui.myLimit += 30; refresh(); },
  custCancel: async id => {
    if (!await ask('Buyurtmani bekor qilasizmi?', 'Bekor qilish', true)) return;
    await api(`/orders/${id}/cancel`, { method: 'POST' }); toast('Buyurtma bekor qilindi'); refresh();
  },
  reorder: async id => {
    const o = S.orderCache.get(Number(id)); if (!o) return;
    if (!S.products.length) await loadProducts();
    let miss = 0;
    for (const i of o.items) { const p = prod(i.productId); if (p && p.active) cart[p.id] = Math.round(((cart[p.id] || 0) + i.qty) * 100) / 100; else miss++; }
    saveCart();
    toast(miss ? `Savatga qo'shildi (${miss} ta mahsulot hozir sotuvda yo'q)` : "Mahsulotlar savatga qo'shildi");
    go('custTab', 'savat');
  },
  askOrder: id => {
    const o = S.orderCache.get(Number(id)); if (!o) return;
    closeModal();
    const cid = isAdmin() ? o.customer.id : S.me.id;
    ui.drafts[cid] = `Buyurtma #${o.id} bo'yicha: `;
    if (isAdmin()) { ui.chatWith = cid; go('adminTab', 'chat'); } else go('custTab', 'chat');
    setTimeout(() => { const t = $('#chatText'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 50);
  },
  of: id => { ui.orderFilter = id; ui.orderLimit = 40; refresh(); },
  more: () => { ui.orderLimit += 40; refresh(); },
  openOrder: id => { $('#toast').classList.remove('show'); openOrder(id); },
  advance: (id, el) => { const n = NEXT[el.dataset.st]; if (n) return changeStatus(id, n.to); },
  cancelOrder: async id => { if (!await ask('Buyurtma bekor qilinsinmi?', 'Bekor qilish', true)) return; await changeStatus(id, 'bekor'); },
  closeModal: () => closeModal(),
  printModal: () => { document.body.classList.add('print-modal'); window.print(); },
  print: () => window.print(),
  newProduct: () => productForm(null),
  editProduct: id => productForm(prod(id)),
  stockIn: id => { const p = prod(id); if (p) stockForm(p, 'in'); },
  stockSet: id => { const p = prod(id); if (p) stockForm(p, 'set'); },
  toggleProduct: async id => {
    const p = prod(id); if (!p) return;
    await api(`/products/${p.id}`, { method: 'PUT', body: { name: p.name, category: p.category, unit: p.unit, price: p.price, active: !p.active } });
    refresh();
  },
  delProduct: async id => {
    if (!await ask("Mahsulot o'chirilsinmi? Eski buyurtmalar va hisobotlarda u saqlanib qoladi.", "O'chirish", true)) return;
    await api(`/products/${id}`, { method: 'DELETE' }); closeModal(); toast("Mahsulot o'chirildi"); refresh();
  },
  pickPhoto: () => $('#photoInput')?.click(),
  rmPhoto: () => { ui.formPhoto = ''; updatePhotoUI(); },
  rType: id => { ui.rType = id; refresh(); },
  rView: id => { ui.rView = id; render(); refresh(); },
  rShift: id => {
    const k = Number(id), [y, m, d] = ui.rDate.split('-').map(Number);
    const nd = ui.rType === 'kunlik' ? new Date(y, m - 1, d + k) : ui.rType === 'haftalik' ? new Date(y, m - 1, d + 7 * k) : new Date(y, m - 1 + k, 1);
    ui.rDate = ymd(nd); refresh();
  },
  rToday: () => { ui.rDate = ymd(new Date()); refresh(); },
  exportCsv: () => {
    const p = period();
    if (ui.rView === 'ombor') { location.href = `/api/admin/stock-report.csv?from=${p.from}&to=${p.to}&label=${encodeURIComponent(`${TYPE_LABEL[ui.rType]} ombor hisobi: ${p.label}`)}`; return; }
    location.href = `/api/admin/reports.csv?from=${p.from}&to=${p.to}&basis=${ui.rBasis}&label=${encodeURIComponent(`${TYPE_LABEL[ui.rType]} hisobot: ${p.label}`)}`;
  },
  chatWith: id => { ui.chatWith = Number(id); go('adminTab', 'chat'); },
  newCustomer: () => customerForm(null),
  delCustomer: async id => {
    const c = S.customers.find(x => x.id === Number(id)); if (!c) return;
    const msg = c.orders
      ? `"${c.shop || c.name}" o'chirilsinmi? U endi kira olmaydi va ro'yxatdan yo'qoladi. Uning ${c.orders} ta buyurtmasi hisobotlarda saqlanib qoladi.`
      : `"${c.shop || c.name}" o'chirilsinmi? U endi kira olmaydi va ro'yxatdan yo'qoladi.`;
    if (!await ask(msg, "O'chirish", true)) return;
    await api(`/admin/customers/${c.id}`, { method: 'DELETE' });
    if (ui.chatWith === c.id) ui.chatWith = null;
    toast("Mijoz o'chirildi"); refresh();
  },
  editCustomer: id => { const c = S.customers.find(x => x.id === Number(id)); if (c) customerForm(c); },
  chatBack: () => { ui.chatWith = null; render(); },
  goChat: id => {
    $('#toast').classList.remove('show');
    if (isAdmin()) { ui.chatWith = Number(id); go('adminTab', 'chat'); } else go('custTab', 'chat');
  },
  attachPhoto: () => $('#chatPhoto')?.click(),
  viewImg: src => openModal(`<div class="m-head"><h3>Rasm</h3><button class="x" data-a="closeModal" aria-label="Yopish">✕</button></div><img src="${esc(src)}" alt="Rasm" style="width:100%;border-radius:10px;display:block">`),
  resetPw: id => { const c = S.customers.find(x => x.id === Number(id)); if (c) resetPwForm(c); },
  // Super admin
  newAdmin: () => adminForm(null),
  editAdmin: id => { const a = S.admins.find(x => x.id === Number(id)); if (a) adminForm(a); },
  adminPw: id => { const a = S.admins.find(x => x.id === Number(id)); if (a) adminPwForm(a); },
  genPw: (id, el) => { const i = el.closest('form')?.elements.password; if (i) i.value = genPassword(); },
  toggleAdmin: async id => {
    const a = S.admins.find(x => x.id === Number(id)); if (!a) return;
    if (a.active && !await ask(`${a.name} bloklansinmi? U tizimga kira olmaydi.`, 'Bloklash', true)) return;
    await api(`/super/admins/${a.id}/active`, { method: 'POST', body: { active: !a.active } });
    toast(a.active ? 'Admin bloklandi' : 'Admin faollashtirildi'); refresh();
  },
  delAdmin: async id => {
    const a = S.admins.find(x => x.id === Number(id)); if (!a) return;
    if (!await ask(`${a.name} hisobi butunlay o'chirilsinmi? Buni qaytarib bo'lmaydi.`, "O'chirish", true)) return;
    await api(`/super/admins/${a.id}`, { method: 'DELETE' }); toast("Admin hisobi o'chirildi"); refresh();
  },
};

/* Formalar */
const F = {
  login: async f => {
    const d = await api('/auth/login', { method: 'POST', body: { phone: '998' + localDigits(val(f, 'phone')), password: f.elements.password.value } });
    afterLogin(d.user);
  },
  placeOrder: async f => {
    const items = cartItems(); if (!items.length) return;
    const d = await api('/orders', { method: 'POST', body: {
      items: items.map(({ p, q }) => ({ productId: p.id, qty: q })), address: val(f, 'address'), comment: val(f, 'comment'),
    } });
    cart = {}; saveCart();
    toast(`✅ Buyurtma #${d.order.id} yuborildi. Tez orada yig'ib yetkazamiz!`);
    go('custTab', 'buyurtmalar');
  },
  saveProduct: async f => {
    const id = f.dataset.id;
    const body = { name: val(f, 'name'), category: val(f, 'category'), unit: val(f, 'unit'), price: Math.round(Number(val(f, 'price'))), active: f.elements.active.checked };
    if (ui.formPhoto !== ui.formPhotoOrig) body.photo = ui.formPhoto;   // yangi rasm yoki '' (o'chirish)
    if (f.elements.stock) body.stock = val(f, 'stock');
    await api(id ? `/products/${id}` : '/products', { method: id ? 'PUT' : 'POST', body });
    closeModal(); toast(id ? 'Mahsulot yangilandi' : "Mahsulot qo'shildi"); refresh();
  },
  saveStock: async f => {
    const q = val(f, 'qty');
    const d = await api(`/products/${f.dataset.id}/stock`, { method: 'POST', body: f.dataset.mode === 'in' ? { add: q } : { set: q } });
    const p = d.product;
    closeModal(); toast(`${p.name}: omborda ${num(p.stock)} ${SU}`); refresh();
  },
  sendMsg: f => sendMessage(Number(f.dataset.id), f.elements.text.value),
  saveProfile: async f => {
    const d = await api('/me', { method: 'PUT', body: { name: val(f, 'name'), shop: val(f, 'shop'), address: val(f, 'address') } });
    S.me = d.user; closeModal(); render(); toast('Profil saqlandi');
  },
  changePassword: async f => {
    if (f.elements.next.value !== f.elements.next2.value) return toast('Yangi parollar bir xil emas');
    await api('/me/password', { method: 'POST', body: { current: f.elements.current.value, next: f.elements.next.value } });
    closeModal(); toast('Parol almashtirildi');
  },
  superLogin: async f => {
    const d = await api('/auth/super-login', { method: 'POST', body: { login: val(f, 'login'), password: f.elements.password.value } });
    afterLogin(d.user);
  },
  saveAdmin: async f => {
    const id = f.dataset.id;
    const body = { name: val(f, 'name'), phone: '998' + localDigits(val(f, 'phone')), customerLimit: val(f, 'customerLimit') };
    if (!id) body.password = f.elements.password.value;
    await api(id ? `/super/admins/${id}` : '/super/admins', { method: id ? 'PUT' : 'POST', body });
    closeModal();
    toast(id ? "O'zgarishlar saqlandi" : `Admin yaratildi. Kirish: ${fmtPhone(body.phone)}`);
    refresh();
  },
  adminPw: async f => {
    await api(`/super/admins/${f.dataset.id}/password`, { method: 'PUT', body: { password: f.elements.password.value } });
    closeModal(); toast('Yangi parol saqlandi. Uni adminga ayting.'); refresh();
  },
  saveCustomer: async f => {
    const id = f.dataset.id;
    const body = { name: val(f, 'name'), shop: val(f, 'shop'), phone: '998' + localDigits(val(f, 'phone')), address: val(f, 'address') };
    if (!id) body.password = f.elements.password.value;
    await api(id ? `/admin/customers/${id}` : '/admin/customers', { method: id ? 'PUT' : 'POST', body });
    closeModal();
    toast(id ? "O'zgarishlar saqlandi" : `Mijoz qo'shildi. Kirish: ${fmtPhone(body.phone)}, parolni mijozga ayting.`);
    refresh();
  },
  resetPw: async f => {
    await api(`/admin/customers/${f.dataset.id}/password`, { method: 'PUT', body: { password: f.elements.password.value } });
    closeModal(); toast('Yangi parol saqlandi. Uni mijozga ayting.');
  },
};

/* =====================================================================
   Hodisalar
   ===================================================================== */
document.addEventListener('click', async e => {
  if (e.target.id === 'modal') return closeModal();
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.dataset.busy) return;
  el.dataset.busy = '1';
  try { await fn(el.dataset.id, el, e); } catch (err) { fail(err); } finally { delete el.dataset.busy; }
});
document.addEventListener('submit', async e => {
  const f = e.target, h = F[f.dataset.form]; if (!h) return;
  e.preventDefault();
  if (f.dataset.busy) return;
  f.dataset.busy = '1';
  const btns = [...f.querySelectorAll('button:not([type=button])')]; btns.forEach(b => { b.disabled = true; });
  try { await h(f); } catch (err) { if (['login', 'superLogin'].includes(f.dataset.form)) authErr(err.message); else fail(err); }
  finally { delete f.dataset.busy; btns.forEach(b => { b.disabled = false; }); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'search') { ui.q = t.value; const g = $('#grid'); if (g) g.innerHTML = gridHtml(); }
  if (t.id === 'chatText') { ui.drafts[t.dataset.draft] = t.value; autoGrow(); }
  if (t.hasAttribute('data-phone')) t.value = fmtLocal(localDigits(t.value));
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.qty) setQty(t.dataset.qty, t.value);
  if (t.id === 'rDate' && t.value) { ui.rDate = t.value; refresh(); }
  if (t.id === 'rBasis') { ui.rBasis = t.value; refresh(); }
  if (t.id === 'photoInput' && t.files[0]) { handlePhoto(t.files[0]); t.value = ''; }
  if (t.id === 'chatPhoto' && t.files[0]) {
    const cid = Number(t.closest('form').dataset.id);
    readPhoto(t.files[0]).then(d => sendMessage(cid, '', d)).catch(err => fail(err.message === 'type' || err.message === 'load' ? { message: "Rasmni o'qib bo'lmadi" } : err));
    t.value = '';
  }
  if (t.id === 'newChat' && t.value) { ui.chatWith = Number(t.value); go('adminTab', 'chat'); }
});
// Kompyuterda Enter — yuborish, Shift+Enter — yangi qator. Telefonda yuborish tugma bilan.
const coarse = window.matchMedia('(pointer: coarse)').matches;
document.addEventListener('keydown', e => {
  if (e.target.id === 'chatText' && e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
  if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
});
// "Yuborish" tugmasi bosilganda klaviatura yopilib qolmasligi uchun
document.addEventListener('mousedown', e => { if (e.target.closest('.chat-input .send, .chat-input .icon-btn')) e.preventDefault(); });
// Rasmni sudrab tashlash (kompyuterda)
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  const z = e.target.closest?.('#photoDrop'); if (!z) return; e.preventDefault(); z.classList.add('drag');
}));
document.addEventListener('dragleave', e => { e.target.closest?.('#photoDrop')?.classList.remove('drag'); });
document.addEventListener('drop', e => {
  const z = e.target.closest?.('#photoDrop'); if (!z) return; e.preventDefault(); z.classList.remove('drag');
  if (e.dataTransfer.files[0]) handlePhoto(e.dataTransfer.files[0]);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) refresh(); });
window.addEventListener('resize', () => fitChat({ atBottom: true }));
window.addEventListener('afterprint', () => document.body.classList.remove('print-modal'));

/* ---------- Ishga tushish ---------- */
(async function boot() {
  try { S.cfg = await api('/config'); } catch { /* standart nom qoladi */ }
  try {
    const d = await api('/me');
    if (d.user) afterLogin(d.user); else render();
  } catch (e) {
    $('#app').innerHTML = `<div class="auth-wrap">${empty('⚠️', esc(e.message), '<button class="btn primary" data-a="reload">Qayta urinish</button>')}</div>`;
  }
})();
