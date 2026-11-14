'use strict';
// Super admin yaratish yoki uning parolini tiklash:
//   npm run superadmin -- Tohirbey1 YangiParol
const { get, run } = require('../src/db');
const { login: loginField, isWeakPassword } = require('../src/util');
const { hashPassword } = require('../src/auth');

(async () => {
  const [rawLogin, password] = process.argv.slice(2);
  if (!rawLogin || !password) {
    console.log('Foydalanish: npm run superadmin -- <login> <parol>');
    process.exit(1);
  }
  const lg = loginField(rawLogin);
  if (isWeakPassword(password)) { console.error("Parol kamida 8 belgidan iborat va oddiy bo'lmasligi kerak."); process.exit(1); }
  const hash = await hashPassword(password);
  const existing = get("SELECT * FROM users WHERE role = 'superadmin' AND login = ?", lg);
  if (existing) {
    run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', hash, existing.id);
    run('DELETE FROM sessions WHERE user_id = ?', existing.id);
    console.log(`Super admin paroli yangilandi: ${lg}`);
  } else {
    run(`INSERT INTO users (role, login, name, password_hash, created_at) VALUES ('superadmin', ?, 'Super admin', ?, ?)`, lg, hash, Date.now());
    console.log(`Super admin yaratildi: ${lg}  (kirish sahifasi: /super)`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
