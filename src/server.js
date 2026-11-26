'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { db, get, run } = require('./db');
const { HttpError, phone, isWeakPassword, login: loginField } = require('./util');
const { loadUser, hashPassword } = require('./auth');
const events = require('./events');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'", "script-src 'self'",
    "connect-src 'self'", "font-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

// Boshqa saytlardan yashirin so'rov yuborishga qarshi (CSRF): o'zgartiruvchi so'rovlar faqat JSON va shu saytdan
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.is('application/json')) return next(new HttpError(415, "So'rov formati noto'g'ri"));
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* */ }
    if (host !== req.host) return next(new HttpError(403, "Ruxsat etilmagan so'rov"));
  }
  next();
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || err.statusCode || 500;
  let message = err instanceof HttpError ? err.message : 'Serverda xatolik yuz berdi. Birozdan keyin qayta urinib ko\'ring.';
  if (err.type === 'entity.too.large') message = "Yuborilgan fayl juda katta";
  else if (err.type === 'entity.parse.failed') message = "So'rov formati noto'g'ri";
  else if (status === 404 && !(err instanceof HttpError)) message = 'Topilmadi';
  if (status >= 500) console.error(new Date().toISOString(), req.method, req.originalUrl, err);
  if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('text/plain; charset=utf-8').send(message);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);
  app.use(express.json({ limit: '6mb' }));
  app.use(loadUser);

  app.use('/api', csrfGuard);
  app.use('/api', require('./routes/auth'));
  app.use('/api', require('./routes/products'));
  app.use('/api', require('./routes/orders'));
  app.use('/api', require('./routes/chat'));
  app.use('/api', require('./routes/admin'));
  app.use('/api', require('./routes/super'));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Topilmadi')));

  // Yuklangan rasmlar faqat tizimga kirganlarga ko'rinadi
  app.use('/uploads', (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Tizimga kiring'))),
    express.static(config.uploadsDir, { maxAge: '30d', immutable: true, index: false, fallthrough: false }));

  // Qidiruv tizimlari (Google) uchun: robots.txt, sitemap.xml va manzili qo'yilgan bosh sahifa
  const origin = req => { const h = req.get('host') || ''; return /^[a-z0-9.:[\]-]+$/i.test(h) ? `${req.protocol}://${h}` : ''; };
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(
    `User-agent: *\nDisallow: /super\nDisallow: /api/\nDisallow: /uploads/\n\nSitemap: ${origin(req)}/sitemap.xml\n`));
  app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin(req)}/</loc></url>\n</urlset>\n`));
  const indexFile = path.join(config.publicDir, 'index.html');
  const sendIndex = (req, res) => {
    const html = fs.readFileSync(indexFile, 'utf8').replaceAll('{{ORIGIN}}', origin(req))
      .replace('{{ROBOTS}}', /^\/super/.test(req.path) ? 'noindex, nofollow' : 'index, follow');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  };
  app.get(['/', '/index.html'], sendIndex);

  app.use(express.static(config.publicDir, {
    index: false,
    setHeaders(res, file) { if (/\.(html|js|css|webmanifest|svg)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  // Boshqa barcha sahifa manzillari — ilovaning o'zi
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) return sendIndex(req, res);
    next(new HttpError(404, 'Topilmadi'));
  });
  app.use(errorHandler);
  return app;
}

// Birinchi ishga tushishda .env dagi SUPERADMIN_LOGIN / SUPERADMIN_PASSWORD bo'yicha super admin yaratiladi
async function ensureSuperadmin() {
  if (get("SELECT 1 FROM users WHERE role = 'superadmin'")) return;
  const { login: rawLogin, password } = config.superadmin;
  if (!rawLogin || !password) {
    console.warn("DIQQAT: super admin hisobi yo'q. .env faylida SUPERADMIN_LOGIN va SUPERADMIN_PASSWORD ni kiriting\n" +
      "yoki buyruq bilan yarating:  npm run superadmin -- Login Parol");
    return;
  }
  const lg = loginField(rawLogin);
  if (isWeakPassword(password)) {
    console.error("XATO: SUPERADMIN_PASSWORD juda oddiy (kamida 8 belgi kerak). Super admin yaratilmadi.");
    return;
  }
  run(`INSERT INTO users (role, login, name, password_hash, created_at) VALUES ('superadmin', ?, 'Super admin', ?, ?)`,
    lg, await hashPassword(password), Date.now());
  console.log(`Super admin yaratildi: ${lg}  (kirish sahifasi: /super)`);
}

// Ixtiyoriy: .env dagi ADMIN_PHONE / ADMIN_PASSWORD bo'yicha birinchi admin yaratiladi
async function ensureAdmin() {
  if (get("SELECT 1 FROM users WHERE role = 'admin'")) return;
  const { phone: rawPhone, password, name } = config.admin;
  if (!rawPhone || !password) return;   // adminlarni super admin qo'shadi
  const ph = phone(rawPhone);
  const weak = isWeakPassword(password);
  if (weak && process.env.NODE_ENV === 'production') {
    console.error("XATO: ADMIN_PASSWORD juda oddiy. .env faylida kamida 8 belgili kuchli parol yozing va qayta ishga tushiring.");
    return;
  }
  if (weak) console.warn("DIQQAT: admin paroli juda oddiy. Serverda kuchli parol qo'ying.");
  const existing = get('SELECT * FROM users WHERE phone = ?', ph);
  if (existing) {
    console.warn(`DIQQAT: ${ph} raqami mijoz sifatida ro'yxatdan o'tgan. Admin uchun boshqa raqam kiriting.`);
    return;
  }
  run(`INSERT INTO users (role, name, shop, phone, address, password_hash, created_at) VALUES ('admin', ?, '', ?, '', ?, ?)`,
    name, ph, await hashPassword(password), Date.now());
  console.log(`Admin hisobi yaratildi: +${ph}`);
}

async function start() {
  await ensureSuperadmin();
  await ensureAdmin();
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`${config.appName} ishga tushdi: http://localhost:${config.port}  (ma'lumotlar: ${config.dataDir})`);
  });
  const shutdown = () => {
    console.log("To'xtatilmoqda...");
    events.closeAll();
    server.close(() => { db.close(); process.exit(0); });
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });

module.exports = { createApp, start, ensureAdmin, ensureSuperadmin };
