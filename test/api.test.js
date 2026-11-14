'use strict';
// API testlari: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taminot-test-'));
process.env.TAMINOT_SKIP_ENV_FILE = '1';
process.env.DATA_DIR = tmp;
process.env.ADMIN_PHONE = '998900000000';
process.env.ADMIN_PASSWORD = 'admin-parol-123';

const { createApp, ensureAdmin } = require('../src/server');
const events = require('../src/events');
const { db } = require('../src/db');

let server, base;
before(async () => {
  await ensureAdmin();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  events.closeAll();
  server.closeAllConnections();
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Har bir "brauzer" o'z cookie'sini saqlaydi
function client() {
  let cookie = '';
  return async (method, url, body, extraHeaders = {}) => {
    const headers = { ...extraHeaders };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const [kv] = c.split(';'); if (kv.startsWith('sid=')) cookie = kv.endsWith('=') ? '' : kv; }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers, cookie: () => cookie };
  };
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const admin = client();
const cust = client();
const other = client();
let productId, product2Id, orderId, custId;

test('admin .env bo\'yicha yaratiladi va kira oladi', async () => {
  const bad = await admin('POST', '/api/auth/login', { phone: '+998 90 000 00 00', password: 'notogri' });
  assert.equal(bad.status, 401);
  const r = await admin('POST', '/api/auth/login', { phone: '+998 90 000 00 00', password: 'admin-parol-123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
});

test("mijoz ro'yxatdan o'tadi (telefon + parol)", async () => {
  const r = await cust('POST', '/api/auth/register', { name: 'Azizbek Karimov', shop: 'Baraka', phone: '90 111 22 33', address: 'Chilonzor 9', password: '123456' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.phone, '998901112233');
  custId = r.data.user.id;
  const dup = await other('POST', '/api/auth/register', { name: 'Boshqa', phone: '998901112233', address: 'Manzil', password: '123456' });
  assert.equal(dup.status, 409);
  const short = await other('POST', '/api/auth/register', { name: 'Boshqa', phone: '998931234567', address: 'Manzil', password: '123' });
  assert.equal(short.status, 400);
  const ok = await other('POST', '/api/auth/register', { name: 'Dilnoza', phone: '998931234567', address: 'Yunusobod', password: '654321' });
  assert.equal(ok.status, 201);
});

test('parol bazada ochiq holda saqlanmaydi', () => {
  const row = db.prepare('SELECT password_hash FROM users WHERE phone = ?').get('998901112233');
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.ok(!row.password_hash.includes('123456'));
});

test('faqat admin mahsulot qo\'sha oladi; rasm tekshiriladi', async () => {
  const denied = await cust('POST', '/api/products', { name: 'Un', category: 'Un', unit: 'qop', price: 1000 });
  assert.equal(denied.status, 403);
  const badImg = await admin('POST', '/api/products', { name: 'Un', category: 'Un', unit: 'qop', price: 1000, photo: 'data:image/png;base64,' + Buffer.from('salom').toString('base64') });
  assert.equal(badImg.status, 400);
  const r = await admin('POST', '/api/products', { name: 'Un oliy nav 50 kg', category: 'Un va yorma', unit: 'qop', price: 265000, photo: PNG_1PX });
  assert.equal(r.status, 201);
  assert.match(r.data.product.photo, /^\/uploads\/p_[0-9a-f]{32}\.png$/);
  productId = r.data.product.id;
  const r2 = await admin('POST', '/api/products', { name: 'Guruch', category: 'Un va yorma', unit: 'kg', price: 17500 });
  product2Id = r2.data.product.id;
  // rasm faqat tizimga kirganlarga ko'rinadi
  const img = await cust('GET', r.data.product.photo);
  assert.equal(img.status, 200);
  const anon = await fetch(base + r.data.product.photo);
  assert.equal(anon.status, 401);
});

test('mijoz buyurtma beradi, narx serverda hisoblanadi', async () => {
  const r = await cust('POST', '/api/orders', {
    items: [{ productId, qty: 2, price: 1 }, { productId: product2Id, qty: 10 }, { productId, qty: 1 }],
    address: 'Chilonzor 9', comment: 'Ertalab',
  });
  assert.equal(r.status, 201);
  orderId = r.data.order.id;
  assert.ok(orderId >= 1001, 'buyurtma raqami 1001 dan boshlanadi');
  assert.equal(r.data.order.total, 3 * 265000 + 10 * 17500);
  assert.equal(r.data.order.items.length, 2);
  assert.equal(r.data.order.status, 'yangi');
});

test("yashirilgan mahsulotga buyurtma berib bo'lmaydi", async () => {
  await admin('PUT', `/api/products/${product2Id}`, { name: 'Guruch', category: 'Un va yorma', unit: 'kg', price: 18000, active: false });
  const list = await cust('GET', '/api/products');
  assert.ok(!list.data.products.some(p => p.id === product2Id));
  const r = await cust('POST', '/api/orders', { items: [{ productId: product2Id, qty: 1 }], address: 'Chilonzor 9' });
  assert.equal(r.status, 400);
  await admin('PUT', `/api/products/${product2Id}`, { name: 'Guruch', category: 'Un va yorma', unit: 'kg', price: 18000, active: true });
});

test("admin buyurtmani ko'radi va holatini o'zgartiradi; mijoz o'zgartira olmaydi", async () => {
  const list = await admin('GET', '/api/orders?status=faol');
  assert.equal(list.status, 200);
  assert.equal(list.data.counts.yangi, 1);
  assert.equal(list.data.orders[0].customer.phone, '998901112233');
  const sum = await admin('GET', '/api/summary');
  assert.equal(sum.data.newOrders, 1);

  const hack = await cust('POST', `/api/orders/${orderId}/status`, { status: 'yetkazildi' });
  assert.equal(hack.status, 403);
  const foreign = await other('GET', `/api/orders/${orderId}`);
  assert.equal(foreign.status, 404, 'boshqa mijoz buyurtmasini ko\'ra olmaydi');

  for (const s of ['yigilmoqda', 'yolda', 'yetkazildi']) {
    const r = await admin('POST', `/api/orders/${orderId}/status`, { status: s });
    assert.equal(r.status, 200);
  }
  const det = await cust('GET', `/api/orders/${orderId}`);
  assert.equal(det.data.order.status, 'yetkazildi');
  assert.deepEqual(det.data.order.history.map(h => h.status), ['yangi', 'yigilmoqda', 'yolda', 'yetkazildi']);
  const cancel = await cust('POST', `/api/orders/${orderId}/cancel`, {});
  assert.equal(cancel.status, 409, "yig'ila boshlagan buyurtmani mijoz bekor qila olmaydi");
});

test('mijoz yangi buyurtmasini bekor qila oladi', async () => {
  const r = await cust('POST', '/api/orders', { items: [{ productId, qty: 1 }], address: 'Chilonzor 9' });
  const c = await cust('POST', `/api/orders/${r.data.order.id}/cancel`, {});
  assert.equal(c.status, 200);
  assert.equal(c.data.status, 'bekor');
});

test('hisobot: nima qancha sotildi va ITOGO', async () => {
  const from = Date.now() - 86400000, to = Date.now() + 86400000;
  const r = await admin('GET', `/api/admin/reports?from=${from}&to=${to}&basis=yetkazildi`);
  assert.equal(r.status, 200);
  assert.equal(r.data.count, 1);
  assert.equal(r.data.total, 3 * 265000 + 10 * 17500);
  assert.equal(r.data.notCounted, 1, 'bekor qilingan buyurtma hisobga kirmaydi');
  const un = r.data.products.find(p => p.name.startsWith('Un'));
  assert.equal(un.qty, 3);
  assert.equal(un.sum, 795000);
  assert.equal(r.data.customers[0].orders, 1);
  const denied = await cust('GET', `/api/admin/reports?from=${from}&to=${to}`);
  assert.equal(denied.status, 403);
  const csv = await admin('GET', `/api/admin/reports.csv?from=${from}&to=${to}&label=Test`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /ITOGO/);
});

test('chat: mijoz yozadi, admin javob beradi, o\'qildi belgisi', async () => {
  const m1 = await cust('POST', '/api/chat/messages', { text: 'Salom, shakar bormi?' });
  assert.equal(m1.status, 201);
  let sum = await admin('GET', '/api/summary');
  assert.equal(sum.data.unread, 1);
  const convs = await admin('GET', '/api/chat/conversations');
  assert.equal(convs.data.conversations[0].customer.id, custId);
  assert.equal(convs.data.conversations[0].unread, 1);
  await admin('POST', '/api/chat/read', { customerId: custId });
  sum = await admin('GET', '/api/summary');
  assert.equal(sum.data.unread, 0);
  const m2 = await admin('POST', '/api/chat/messages', { customerId: custId, text: 'Ha, bor' });
  assert.equal(m2.status, 201);
  const thread = await cust('GET', '/api/chat/messages');
  assert.deepEqual(thread.data.messages.map(m => m.sender), ['customer', 'admin']);
  assert.ok(thread.data.messages[0].readAt, "mijoz xabari o'qilgan deb belgilangan");
  // boshqa mijoz bu suhbatni ko'rmaydi
  const otherThread = await other('GET', '/api/chat/messages');
  assert.equal(otherThread.data.messages.length, 0);
  const empty = await cust('POST', '/api/chat/messages', { text: '   ' });
  assert.equal(empty.status, 400);
});

test('real vaqt: admin yangi buyurtma haqida darhol xabar oladi', async () => {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/events', { headers: { cookie: (await admin('GET', '/api/me')).cookie() }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const got = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return buf;
      buf += Buffer.from(value).toString();
      if (buf.includes('event: order:new')) return buf;
    }
  })();
  await new Promise(r => setTimeout(r, 50));
  await cust('POST', '/api/orders', { items: [{ productId, qty: 1 }], address: 'Chilonzor 9' });
  const text = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('kutish vaqti tugadi')), 3000))]);
  ctrl.abort();
  assert.match(text, /event: order:new/);
  assert.match(text, /"shop":"Baraka"/);
});

test('xavfsizlik: CSRF va kirishsiz so\'rovlar', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/orders')).status, 401);
  // JSON bo'lmagan so'rov rad etiladi (boshqa saytdan yuboriladigan forma)
  const form = await cust('POST', '/api/chat/messages', 'text=salom', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  // Boshqa saytdan kelgan so'rov rad etiladi
  const cross = await cust('POST', '/api/chat/messages', { text: 'salom' }, { origin: 'https://yomon-sayt.example' });
  assert.equal(cross.status, 403);
  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('"Admin sifatida kirish" sahifasidan faqat admin kiradi', async () => {
  const c = await client()('POST', '/api/auth/login', { phone: '998931234567', password: '654321', as: 'admin' });
  assert.equal(c.status, 403);
  assert.match(c.data.error, /admin emas/);
  const a = await client()('POST', '/api/auth/login', { phone: '998900000000', password: 'admin-parol-123', as: 'admin' });
  assert.equal(a.status, 200);
  assert.equal(a.data.user.role, 'admin');
  const page = await fetch(base + '/admin', { headers: { accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="app">/);
});

test("parolni almashtirish va admin tomonidan tiklash", async () => {
  const wrong = await cust('POST', '/api/me/password', { current: 'xato', next: 'yangi-parol' });
  assert.equal(wrong.status, 400);
  const ok = await cust('POST', '/api/me/password', { current: '123456', next: 'yangi-parol' });
  assert.equal(ok.status, 200);
  const reset = await admin('PUT', `/api/admin/customers/${custId}/password`, { password: 'admin-qoydi' });
  assert.equal(reset.status, 200);
  assert.equal((await cust('GET', '/api/orders')).status, 401, 'eski sessiya bekor bo\'ldi');
  const login = await cust('POST', '/api/auth/login', { phone: '998901112233', password: 'admin-qoydi' });
  assert.equal(login.status, 200);
});
