'use strict';
// Super admin testlari: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taminot-super-'));
process.env.TAMINOT_SKIP_ENV_FILE = '1';
process.env.DATA_DIR = tmp;
process.env.SUPERADMIN_LOGIN = 'Tohirbey1';
process.env.SUPERADMIN_PASSWORD = 'Tohirbey12';
delete process.env.ADMIN_PHONE;
delete process.env.ADMIN_PASSWORD;

const { createApp, ensureSuperadmin, ensureAdmin } = require('../src/server');
const events = require('../src/events');
const { db } = require('../src/db');

let server, base;
before(async () => {
  await ensureSuperadmin();
  await ensureAdmin();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  events.closeAll(); server.closeAllConnections(); server.close(); db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); if (kv.startsWith('sid=')) cookie = kv.endsWith('=') ? '' : kv; }
    let data = null; try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  };
}

const sup = client(), adm = client(), cust = client();
let adminId;

test(".env bo'yicha super admin yaratiladi; boshqa admin yo'q", () => {
  const rows = db.prepare('SELECT role, login, phone FROM users').all();
  assert.deepEqual(rows.map(r => ({ ...r })), [{ role: 'superadmin', login: 'Tohirbey1', phone: null }]);
});

test('super admin login va parol bilan kiradi', async () => {
  assert.equal((await sup('POST', '/api/auth/super-login', { login: 'Tohirbey1', password: 'xato' })).status, 401);
  const r = await sup('POST', '/api/auth/super-login', { login: 'tohirbey1', password: 'Tohirbey12' });
  assert.equal(r.status, 200, 'login katta-kichik harfga sezgir emas');
  assert.equal(r.data.user.role, 'superadmin');
  assert.equal(r.data.user.login, 'Tohirbey1');
  // oddiy kirish sahifasidan super admin kira olmaydi
  assert.equal((await client()('POST', '/api/auth/login', { phone: 'Tohirbey1', password: 'Tohirbey12' })).status, 400);
});

test('super admin faqat adminlarni boshqaradi: buyurtma, mahsulot, hisobotga kira olmaydi', async () => {
  for (const url of ['/api/orders', '/api/orders/1001', '/api/products', '/api/admin/customers', '/api/chat/conversations', '/api/chat/messages?customerId=1', '/api/events', '/api/admin/reports?from=0&to=1000']) {
    assert.equal((await sup('GET', url)).status, 403, url);
  }
  assert.equal((await sup('POST', '/api/products', { name: 'X', category: 'Y', unit: 'dona', price: 1 })).status, 403);
});

test('super admin admin hisobini ochadi, admin u bilan kiradi', async () => {
  const weak = await sup('POST', '/api/super/admins', { name: 'Jasur Aliyev', phone: '90 123 45 67', password: '1234567', customerLimit: 1 });
  assert.equal(weak.status, 400, 'admin paroli kamida 8 belgi');
  const noLimit = await sup('POST', '/api/super/admins', { name: 'Jasur Aliyev', phone: '90 123 45 67', password: 'Jasur-2026' });
  assert.equal(noLimit.status, 400, "nechta mijoz qo'sha olishi majburiy");
  const r = await sup('POST', '/api/super/admins', { name: 'Jasur Aliyev', phone: '90 123 45 67', password: 'Jasur-2026', customerLimit: 1 });
  assert.equal(r.status, 201);
  adminId = r.data.admin.id;
  assert.equal(r.data.admin.phone, '998901234567');
  assert.equal(r.data.admin.customerLimit, 1);
  const dup = await sup('POST', '/api/super/admins', { name: 'Boshqa', phone: '998901234567', password: 'Boshqa-2026', customerLimit: 5 });
  assert.equal(dup.status, 409);

  const login = await adm('POST', '/api/auth/login', { phone: '998901234567', password: 'Jasur-2026' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'admin');
  assert.equal((await adm('GET', '/api/orders')).status, 200, 'admin buyurtmalarni ko\'radi');
  assert.equal((await adm('GET', '/api/super/admins')).status, 403, 'admin boshqa adminlarni boshqara olmaydi');

  const list = await sup('GET', '/api/super/admins');
  assert.equal(list.data.admins.length, 1);
  assert.ok(list.data.admins[0].lastLoginAt, 'oxirgi kirish vaqti yoziladi');
});

test("mijoz raqamini admin uchun ishlatib bo'lmaydi; mijoz super panelga kira olmaydi", async () => {
  // Admin super admin belgilagan songacha mijoz qo'sha oladi
  const c1 = await adm('POST', '/api/admin/customers', { name: 'Mijoz', phone: '998935556677', address: 'Yunusobod', password: '123456' });
  assert.equal(c1.status, 201);
  const c2 = await adm('POST', '/api/admin/customers', { name: 'Ikkinchi', phone: '998935556678', address: 'Yunusobod', password: '123456' });
  assert.equal(c2.status, 403, 'limit 1 ta');
  assert.match(c2.data.error, /ko'pi bilan 1 ta/);
  assert.equal((await adm('GET', '/api/admin/customers')).data.limit.used, 1);
  assert.equal((await sup('GET', '/api/super/admins')).data.admins[0].customersAdded, 1);
  assert.equal((await sup('PUT', `/api/super/admins/${adminId}`, { name: 'Jasur Aliyev', phone: '998901234567', customerLimit: 2 })).status, 200);
  assert.equal((await adm('POST', '/api/admin/customers', { name: 'Ikkinchi', phone: '998935556678', address: 'Yunusobod', password: '123456' })).status, 201);
  assert.equal((await cust('POST', '/api/auth/login', { phone: '998935556677', password: '123456' })).status, 200);

  assert.equal((await sup('POST', '/api/super/admins', { name: 'Xodim', phone: '998935556677', password: 'Kuchli-2026', customerLimit: 5 })).status, 409);
  assert.equal((await cust('GET', '/api/super/admins')).status, 403);
  assert.equal((await cust('DELETE', `/api/super/admins/${adminId}`, {})).status, 403);
});

test('tahrirlash va parolni tiklash', async () => {
  const e = await sup('PUT', `/api/super/admins/${adminId}`, { name: 'Jasur A.', phone: '998901234567' });
  assert.equal(e.status, 200);
  assert.equal(e.data.admin.name, 'Jasur A.');
  assert.equal(e.data.admin.customerLimit, 2, "limit berilmasa o'zgarmaydi");
  const p = await sup('PUT', `/api/super/admins/${adminId}/password`, { password: 'Yangi-Parol-1' });
  assert.equal(p.status, 200);
  assert.equal((await adm('GET', '/api/orders')).status, 401, 'eski kirish bekor bo\'ldi');
  assert.equal((await adm('POST', '/api/auth/login', { phone: '998901234567', password: 'Jasur-2026' })).status, 401);
  assert.equal((await adm('POST', '/api/auth/login', { phone: '998901234567', password: 'Yangi-Parol-1' })).status, 200);
});

test('bloklash va qayta faollashtirish', async () => {
  assert.equal((await sup('POST', `/api/super/admins/${adminId}/active`, { active: false })).status, 200);
  assert.equal((await adm('GET', '/api/orders')).status, 401, 'bloklangan admin darhol chiqariladi');
  const blocked = await adm('POST', '/api/auth/login', { phone: '998901234567', password: 'Yangi-Parol-1' });
  assert.equal(blocked.status, 403);
  assert.match(blocked.data.error, /bloklangan/);
  await sup('POST', `/api/super/admins/${adminId}/active`, { active: true });
  assert.equal((await adm('POST', '/api/auth/login', { phone: '998901234567', password: 'Yangi-Parol-1' })).status, 200);
});

test("admin hisobini o'chirish", async () => {
  assert.equal((await sup('DELETE', `/api/super/admins/${adminId}`, {})).status, 200);
  assert.equal((await adm('GET', '/api/orders')).status, 401);
  assert.equal((await adm('POST', '/api/auth/login', { phone: '998901234567', password: 'Yangi-Parol-1' })).status, 401);
  assert.equal((await sup('GET', '/api/super/admins')).data.admins.length, 0);
});

test("super admin o'z parolini almashtira oladi", async () => {
  assert.equal((await sup('POST', '/api/me/password', { current: 'Tohirbey12', next: 'qisqa' })).status, 400);
  assert.equal((await sup('POST', '/api/me/password', { current: 'Tohirbey12', next: 'Tohirbey-2026' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/super-login', { login: 'Tohirbey1', password: 'Tohirbey-2026' })).status, 200);
});
