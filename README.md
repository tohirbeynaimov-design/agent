# Agent UZ — buyurtma tizimi

**Agent UZ** — mijozlar (do'konlar) ta'minotchiga telefon yoki kompyuterdan buyurtma beradigan web ilova.

- **Mijoz paneli:** admin bergan telefon raqam va parol bilan kirish (mijoz o'zi ro'yxatdan o'ta olmaydi), katalog (rasm, kategoriya, qidiruv), savat, buyurtma berish, buyurtma holatini kuzatish, buyurtmani takrorlash, admin bilan chat (matn va rasm).
- **Admin paneli:** yangi buyurtmalar real vaqtda signal bilan keladi. Buyurtma holatlari: Yangi → Yig'ilmoqda → Yo'lda → Yetkazildi (yoki Bekor qilindi). Yig'ish varaqasini chop etish mumkin.
  - Mahsulot qo'shish (omborda nechta borligi bilan), tahrirlash va rasm yuklash.
  - **Ombor** bo'limi: har bir mahsulotdan omborda nechta qolgani. Mijoz buyurtma berganda qoldiq avtomatik kamayadi (10 qopdan 2 qop olinsa — 8 qop qoladi), buyurtma bekor qilinsa qaytadi. Ombordagidan ko'p buyurtma berib bo'lmaydi; tugagan mahsulot katalogda "Tugagan" deb chiqadi. Yangi kelgan mahsulot "+ Kirim", sanoqdan keyingi aniq son "Tuzatish" tugmasi bilan kiritiladi.
  - Kunlik, haftalik va oylik hisobot: nima qancha sotilgani va ITOGO. Hisobotni Excel (CSV) faylga yuklab olish va chop etish mumkin.
  - **Ombor hisobi** (Hisobotlar → "Ombor hisobi"): tanlangan kun/hafta/oyda har bir mahsulotdan boshida qancha bo'lgani, qancha kirgani, qancha chiqqani va qancha qolgani, hamda har bir kirim va chiqim vaqti bilan (kim qo'shdi, qaysi buyurtma bilan ketdi). Excel'ga yuklab olish mumkin.
  - Mijozlarni admin qo'shadi (ism, do'kon, telefon, manzil, parol), tahrirlaydi va yangi parol qo'yadi; chat.
- **Super admin paneli** (`/super` sahifasi): faqat admin hisoblarini boshqaradi. Admin qo'shish (har bir admin nechta mijoz qo'sha olishini belgilab), tahrirlash, parolini tiklash, bloklash va o'chirish mumkin. Super admin buyurtma, mahsulot, hisobot va chatlarni ko'rmaydi.
- Telefon va kompyuter brauzerida bir xil qulay ishlaydi. Telefonda menyu ekranning pastida turadi.

Texnologiya: **Node.js 22 + Express + SQLite** (bitta fayl baza, alohida baza serveri kerak emas). Real vaqtdagi xabarlar SSE orqali ishlaydi.

---

## 1. Kompyuterda sinab ko'rish

Kerak: [Node.js 22.13 yoki yangiroq](https://nodejs.org).

```bash
npm install
cp .env.example .env        # ichida SUPERADMIN_PASSWORD ni yozing
npm start
```

Brauzerda oching:
- http://localhost:3000/super — super admin (`.env` dagi login va parol). Shu yerda adminlarni qo'shasiz.
- http://localhost:3000 — admin (super admin qo'shgan telefon va parol) va mijozlar.

Testlar: `npm test`

---

## 2. Serverga joylash (tavsiya: Docker)

### Kerak bo'ladi
- **VPS server**: Ubuntu 22.04 yoki 24.04, kamida 1 GB RAM. Har qanday hosting kompaniyasidan olsa bo'ladi.
- **Domen** (masalan `buyurtma.firmangiz.uz`). Domenning **A yozuvi** server IP manziliga yo'naltirilgan bo'lishi kerak.
  Domen hali bo'lmasa ham ishga tushirsa bo'ladi (2.3-qadamga qarang), lekin unda sayt HTTPS'siz ishlaydi.

### 2.1. Serverga Docker o'rnatish
Serverga SSH orqali kiring va bajaring:
```bash
curl -fsSL https://get.docker.com | sudo sh
```

### 2.2. Fayllarni serverga yuklash
O'z kompyuteringizda, shu papka ichida turib (`SERVER_IP` o'rniga serveringiz manzilini yozing):
```bash
rsync -av --exclude node_modules --exclude data --exclude .env ./ root@SERVER_IP:/opt/agent-uz/
```
> `.env` va `data` ataylab yuklanmaydi: ular shu kompyuterdagi sinov uchun. Serverda alohida yoziladi.

### 2.3. Sozlamalarni yozish
Serverda:
```bash
cd /opt/agent-uz
cp .env.example .env
nano .env
```
Quyidagilarni to'ldiring:
- `APP_NAME`: ilova nomi (standart: `Agent UZ`). Oxirgi so'z logodagidek apelsin rangda chiqadi.
- `DOMAIN`: domeningiz. Domen bo'lmasa `DOMAIN=:80` yozing.
- `SUPERADMIN_LOGIN`: super admin logini (masalan `Tohirbey1`).
- `SUPERADMIN_PASSWORD`: super admin paroli, kamida 8 belgi. Oddiy parol bilan server super adminni yaratmaydi.

Super admin faqat **birinchi ishga tushishda** yaratiladi. Keyin uning parolini panelning "Profil" bo'limidan o'zgartirasiz (`.env` dagisi endi ishlatilmaydi).

### 2.4. Ishga tushirish
```bash
docker compose up -d --build
```
Bir-ikki daqiqadan keyin quyidagilarni bajaring. HTTPS sertifikati avtomatik olinadi va yangilanib turadi.
1. `https://DOMENINGIZ/super` ni oching va super admin login-paroli bilan kiring.
2. "+ Admin qo'shish" tugmasi bilan admin(lar) hisobini oching: ism, telefon, parol.
3. Adminlar `https://DOMENINGIZ` sahifasida telefon va parol bilan kiradi. Mijozlar ham shu manzildan, admin bergan telefon raqam va parol bilan kiradi.

Foydali buyruqlar:
```bash
docker compose ps                 # holat
docker compose logs -f app        # ilova loglari
docker compose restart app        # qayta ishga tushirish
```

### 2.5. Yangi versiyani o'rnatish
Kompyuterdan yangi fayllarni 2.2-qadamdagi `rsync` bilan yuklang, so'ng serverda:
```bash
cd /opt/agent-uz && docker compose up -d --build
```
Ma'lumotlar (baza va rasmlar) alohida Docker hajmida (`app_data`) saqlanadi, yangilashda o'chmaydi.

### 2.6. GitHub orqali avtomatik yangilanish
GitHub'ga (`main`) yuklaganingizda avval testlar ishlaydi, ular o'tsa server o'zi yangilanadi (`.github/workflows/deploy.yml` → serverda `scripts/deploy.sh`).
Skript har safar `data/` zaxirasini `~/agent-uz-zaxira` ga oladi, kodni yangilaydi va ilovani qayta ishga tushiradi (Docker, systemd yoki pm2 — avtomatik aniqlanadi).

Bir martalik sozlash:
1. Serverda ilova `git clone` bilan o'rnatilgan bo'lsin (`.git` papkasi bo'lishi kerak).
2. GitHub'da repo → **Settings → Secrets and variables → Actions → New repository secret** orqali qo'shing:
   - `SERVER_HOST`: server IP manzili
   - `SERVER_USER`: SSH foydalanuvchisi (masalan `ubuntu`)
   - `SERVER_SSH_KEY`: serverga kiradigan `.pem` kalitning to'liq matni
   - `APP_DIR` (ixtiyoriy): ilova papkasi, standart `/opt/agent-uz`
   - `RESTART_CMD` (ixtiyoriy): ilova boshqacha ishga tushirilgan bo'lsa, qayta ishga tushirish buyrug'i
3. Natijani repo → **Actions** bo'limida ko'rasiz. Qo'lda ishga tushirish: Actions → "Serverga joylash" → **Run workflow**.

Qo'lda yangilash ham mumkin (serverda): `APP_DIR=/opt/agent-uz bash scripts/deploy.sh`

---

## 3. Kundalik ishlar

**Mijoz parolini unutdi:** Admin panel → Mijozlar → "Parol" tugmasi. Yangi parol qo'yiladi, uni mijozga aytasiz.

**Admin parolini unutdi, yangi admin kerak yoki xodim ishdan ketdi:** super admin paneli (`/super`) orqali. U yerda "Parol", "+ Admin qo'shish", "Bloklash" yoki "O'chirish" tugmalari bor. Bloklangan admin darhol tizimdan chiqariladi.

**Super admin parolini unutdingiz** (serverda bajariladi):
```bash
docker compose exec app npm run superadmin -- Tohirbey1 YangiKuchliParol
```

**Zaxira nusxa (backup).** Qo'lda olish:
```bash
docker compose exec app npm run backup
docker compose cp app:/data/backups ./backups      # nusxalarni serverdagi papkaga chiqarish
```
Har kuni kechasi soat 3:00 da avtomatik olish uchun `crontab -e` buyrug'ini bering va quyidagi qatorni qo'shing:
```
0 3 * * * cd /opt/agent-uz && docker compose exec -T app npm run backup >/dev/null 2>&1
```
Oxirgi 14 ta nusxa saqlanadi. Vaqti-vaqti bilan nusxalarni boshqa joyga (kompyuterga yoki bulutga) ham ko'chirib qo'ying.

**Zaxira nusxadan tiklash.** Avval mavjud nusxalar ro'yxatini ko'ring:
```bash
docker compose exec app ls /data/backups
```
So'ng `<SANA>` o'rniga kerakli nusxa nomini yozib bajaring:
```bash
docker compose stop app
docker compose run --rm app sh -c 'B=/data/backups/<SANA> && cp $B/taminot.db /data/taminot.db && rm -f /data/taminot.db-wal /data/taminot.db-shm && rm -rf /data/uploads && cp -r $B/uploads /data/uploads'
docker compose start app
```

**Telefonga ilova sifatida qo'shish:** saytni telefon brauzerida oching, menyudan "Bosh ekranga qo'shish" (Add to Home screen) ni tanlang.

---

## 4. Docker'siz o'rnatish (ixtiyoriy)

1. Node.js 22 ni o'rnating: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs nginx`
2. Fayllarni `/opt/agent-uz` ga yuklang (2.2-qadam) va `.env` yozing (2.3-qadam).
3. `cd /opt/agent-uz && npm ci --omit=dev`
4. Alohida foydalanuvchi yarating: `sudo useradd -r -s /usr/sbin/nologin agentuz && sudo mkdir -p data && sudo chown -R agentuz data`
5. `deploy/agent-uz.service` faylini `/etc/systemd/system/` ga nusxalang: `sudo systemctl enable --now agent-uz`
6. `deploy/nginx.conf` faylidan nginx sozlamasini oling, HTTPS uchun: `sudo certbot --nginx -d DOMENINGIZ`

Zaxira nusxa: `cd /opt/agent-uz && sudo -u agentuz npm run backup`.

---

## 5. Xavfsizlik bo'yicha qilinganlar
- Parollar ochiq saqlanmaydi: ular scrypt bilan xeshlanadi.
- Sessiya HttpOnly cookie'da saqlanadi. HTTPS orqali ochilganda cookie faqat HTTPS'da yuboriladi (Secure).
- Parolni ko'p marta xato tersa, 15 daqiqaga bloklanadi.
- Narx va jami summani faqat server hisoblaydi. Mijoz brauzerdan narxni o'zgartira olmaydi.
- Mijoz faqat o'z buyurtmalari va o'z chatini ko'radi. Admin amallarini mijoz bajara olmaydi.
- Uch xil rol bor: mijoz, admin va super admin. Har biri faqat o'z bo'limiga kiradi: admin adminlarni boshqara olmaydi, super admin esa buyurtma va chatlarni ko'rmaydi.
- Bloklangan yoki o'chirilgan hisob darhol tizimdan chiqariladi.
- Boshqa saytlardan yashirin so'rov yuborish (CSRF) bloklangan. Xavfsizlik sarlavhalari (CSP va boshqalar) o'rnatilgan.
- Yuklangan fayllar rasm ekani tekshiriladi (JPG/PNG/WebP, 3 MB gacha). Ular faqat tizimga kirganlarga ko'rinadi.
- Admin parolini o'zgartirsa, uning boshqa qurilmalardagi kirishlari bekor qilinadi. Mijoz parolini admin tiklaganda mijozning hamma kirishlari bekor qilinadi.

---

## 6. Fayllar tuzilmasi
```
src/            server: baza, kirish, API, real vaqt
  routes/       auth, products, orders, chat, admin (hisobotlar), super (adminlarni boshqarish)
public/         brauzer qismi: index.html, app.js, style.css
scripts/        superadmin.js, admin.js, backup.js
test/           API testlari (npm test)
deploy/         Docker'siz o'rnatish uchun nginx va systemd namunalari
Dockerfile, docker-compose.yml, Caddyfile   Docker bilan joylash
```
