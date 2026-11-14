'use strict';
// Sozlamalar .env faylidan yoki muhit o'zgaruvchilaridan olinadi (namuna: .env.example)
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// Testlarda kompyuterdagi .env o'qilmaydi
if (process.env.TAMINOT_SKIP_ENV_FILE !== '1') {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env bo'lmasa — muhit o'zgaruvchilari ishlatiladi */ }
}

const env = process.env;
// Vaqt mintaqasi (CSV hisobotlardagi sanalar uchun). Standart: Toshkent
if (!env.TZ) env.TZ = 'Asia/Tashkent';
const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');

module.exports = {
  root: ROOT,
  appName: env.APP_NAME || 'Agent UZ',
  port: Number(env.PORT) || 3000,
  host: env.HOST || '0.0.0.0',
  dataDir,
  dbFile: path.join(dataDir, 'taminot.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  publicDir: path.join(ROOT, 'public'),
  // Proksi (Caddy/nginx) orqasida ishlaganda haqiqiy IP va https'ni bilish uchun
  trustProxy: env.TRUST_PROXY || 'loopback, linklocal, uniquelocal',
  sessionDays: Number(env.SESSION_DAYS) || 30,
  // Super admin: faqat admin hisoblarini boshqaradi. Birinchi ishga tushishda shu ma'lumotlar bilan yaratiladi
  superadmin: {
    login: env.SUPERADMIN_LOGIN || '',
    password: env.SUPERADMIN_PASSWORD || '',
  },
  // Ixtiyoriy: birinchi ishga tushishda bitta admin ham yaratish (odatda adminlarni super admin qo'shadi)
  admin: {
    phone: env.ADMIN_PHONE || '',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Administrator',
  },
};
