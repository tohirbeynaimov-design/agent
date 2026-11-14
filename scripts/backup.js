'use strict';
// Zaxira nusxa: DATA_DIR/backups/<sana-vaqt>/ ichiga baza va rasmlar nusxalanadi.
// Oxirgi 14 ta nusxa saqlanadi. Har kuni avtomatik: cron'ga qo'shing (README'ga qarang).
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { db } = require('../src/db');

const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const root = path.join(config.dataDir, 'backups');
const dir = path.join(root, stamp);
fs.mkdirSync(dir, { recursive: true });

// Ishlab turgan bazadan ham xavfsiz nusxa oladi
db.exec(`VACUUM INTO '${path.join(dir, 'taminot.db').replace(/'/g, "''")}'`);
if (fs.existsSync(config.uploadsDir)) fs.cpSync(config.uploadsDir, path.join(dir, 'uploads'), { recursive: true });
console.log(`Zaxira nusxa tayyor: ${dir}`);

const old = fs.readdirSync(root).filter(n => /^\d{4}-\d{2}-\d{2}_/.test(n)).sort().reverse().slice(KEEP);
for (const n of old) fs.rmSync(path.join(root, n), { recursive: true, force: true });
if (old.length) console.log(`Eski nusxalar o'chirildi: ${old.length} ta`);
db.close();
