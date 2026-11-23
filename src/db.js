'use strict';
// SQLite baza (Node.js ichidagi node:sqlite). Bitta fayl: DATA_DIR/taminot.db
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

const db = new DatabaseSync(config.dbFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// Baza tuzilmasi versiyalar bo'yicha (keyingi o'zgarishlar shu ro'yxatga qo'shiladi)
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'customer')),
    name          TEXT    NOT NULL,
    shop          TEXT    NOT NULL DEFAULT '',
    phone         TEXT    NOT NULL UNIQUE,
    address       TEXT    NOT NULL DEFAULT '',
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    category   TEXT    NOT NULL,
    unit       TEXT    NOT NULL,
    price      INTEGER NOT NULL CHECK (price > 0),
    photo      TEXT    NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES users(id),
    status      TEXT    NOT NULL CHECK (status IN ('yangi', 'yigilmoqda', 'yolda', 'yetkazildi', 'bekor')),
    total       INTEGER NOT NULL,
    address     TEXT    NOT NULL,
    comment     TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX orders_created  ON orders(created_at);
  CREATE INDEX orders_customer ON orders(customer_id, created_at);
  CREATE INDEX orders_status   ON orders(status);
  -- Buyurtma raqamlari 1001 dan boshlanadi
  INSERT INTO sqlite_sequence(name, seq) VALUES ('orders', 1000);

  CREATE TABLE order_items (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name       TEXT    NOT NULL,
    unit       TEXT    NOT NULL,
    price      INTEGER NOT NULL,
    qty        REAL    NOT NULL CHECK (qty > 0),
    sum        INTEGER NOT NULL
  );
  CREATE INDEX order_items_order ON order_items(order_id);

  CREATE TABLE order_history (
    id       INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status   TEXT    NOT NULL,
    at       INTEGER NOT NULL,
    by_user  INTEGER
  );
  CREATE INDEX order_history_order ON order_history(order_id);

  CREATE TABLE messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender      TEXT    NOT NULL CHECK (sender IN ('customer', 'admin')),
    sender_id   INTEGER,
    text        TEXT    NOT NULL DEFAULT '',
    photo       TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    read_at     INTEGER
  );
  CREATE INDEX messages_customer ON messages(customer_id, id);
  `,
  // v2: super admin (login bilan kiradi), hisobni bloklash, oxirgi kirish vaqti.
  // SQLite CHECK cheklovini o'zgartirib bo'lmagani uchun jadval qayta quriladi.
  {
    fkOff: true,
    sql: `
    CREATE TABLE users_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      role          TEXT    NOT NULL CHECK (role IN ('superadmin', 'admin', 'customer')),
      login         TEXT    UNIQUE COLLATE NOCASE,
      name          TEXT    NOT NULL,
      shop          TEXT    NOT NULL DEFAULT '',
      phone         TEXT    UNIQUE,
      address       TEXT    NOT NULL DEFAULT '',
      password_hash TEXT    NOT NULL,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      created_by    INTEGER,
      last_login_at INTEGER,
      CHECK (login IS NOT NULL OR phone IS NOT NULL)
    );
    INSERT INTO users_new (id, role, name, shop, phone, address, password_hash, created_at)
      SELECT id, role, name, shop, phone, address, password_hash, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    `,
  },
  // v3: ombor. products.stock — ombordagi qoldiq (NULL: hali kiritilmagan, hisoblanmaydi).
  // order_items.stock_taken — shu qator ombordan ayirilganmi (bekor qilinganda qaytarish uchun).
  `
  ALTER TABLE products ADD COLUMN stock REAL CHECK (stock IS NULL OR stock >= 0);
  ALTER TABLE order_items ADD COLUMN stock_taken INTEGER NOT NULL DEFAULT 0;
  `,
];

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    const m = typeof MIGRATIONS[v] === 'string' ? { sql: MIGRATIONS[v] } : MIGRATIONS[v];
    if (m.fkOff) db.exec('PRAGMA foreign_keys = OFF');   // tranzaksiyadan tashqarida bo'lishi shart
    try {
      tx(() => {
        db.exec(m.sql);
        if (m.fkOff) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error('Migratsiyadan keyin bog\'lanishlar buzildi: ' + JSON.stringify(broken.slice(0, 3)));
        }
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } finally {
      if (m.fkOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// Tranzaksiya: hammasi bajariladi yoki hech biri
let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* allaqachon bekor qilingan */ }
    throw e;
  } finally {
    depth--;
  }
}

const q = {
  get: (sql, ...params) => db.prepare(sql).get(...params),
  all: (sql, ...params) => db.prepare(sql).all(...params),
  run: (sql, ...params) => db.prepare(sql).run(...params),
};

migrate();

module.exports = { db, tx, ...q };
