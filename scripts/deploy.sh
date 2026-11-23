#!/usr/bin/env bash
# Serverda yangi versiyani o'rnatish.
# GitHub Actions (.github/workflows/deploy.yml) har bir yuklashdan keyin shuni serverda ishga tushiradi.
# Qo'lda ham ishlatsa bo'ladi:   APP_DIR=/opt/agent-uz bash scripts/deploy.sh
#
# Nima qiladi:
#   1. data/ papkasining zaxira nusxasini oladi (~/agent-uz-zaxira, oxirgi 10 tasi saqlanadi)
#   2. GitHub'dan yangi kodni oladi (git fetch + reset)
#   3. Ilovani qayta ishga tushiradi: Docker, systemd yoki pm2 — qaysi biri ishlatilayotgan bo'lsa
#   4. Ilova javob berayotganini tekshiradi
# Ilova boshqacha ishga tushirilgan bo'lsa, buyruqni o'zingiz bering: RESTART_CMD="..."
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/agent-uz}"
BRANCH="${BRANCH:-main}"
BACKUP_ROOT="$HOME/agent-uz-zaxira"

log() { echo "==> $*"; }
die() { echo "XATO: $*" >&2; exit 1; }

cd "$APP_DIR" 2>/dev/null || die "$APP_DIR papkasi topilmadi. GitHub'da APP_DIR sirini to'g'ri yozing."
[ -d .git ] || die "$APP_DIR git orqali o'rnatilmagan. Bir marta qo'lda bajaring: git clone https://github.com/tohirbeynaimov-design/agent-uz.git $APP_DIR"

# Serverda qo'lda o'zgartirilgan fayllar bo'lsa to'xtaymiz — ular yo'qolib ketmasin.
# data/ hisobga olinmaydi: eski versiyada baza git ichida edi.
changed="$(git status --porcelain --untracked-files=no -- . ':(exclude)data')"
if [ -n "$changed" ]; then
  echo "$changed" >&2
  die "serverda qo'lda o'zgartirilgan fayllar bor (yuqorida). Ularni GitHub'ga ham kiriting yoki 'git checkout -- FAYL' bilan bekor qiling."
fi

# 1. Zaxira nusxa
stamp="$(date +%Y-%m-%d_%H-%M-%S)"
backup="$BACKUP_ROOT/data_$stamp"
if [ -d data ]; then
  mkdir -p "$BACKUP_ROOT"
  cp -a data "$backup"
  log "data/ zaxirasi: $backup"
  ls -1dt "$BACKUP_ROOT"/data_* 2>/dev/null | tail -n +11 | xargs -r rm -rf --
fi

# 2. Yangi kod
old="$(git rev-parse --short HEAD)"
git fetch --quiet origin "$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
new="$(git rev-parse --short HEAD)"
log "Kod yangilandi: $old -> $new"

# Eski versiyada data/ git ichida edi: reset uni o'chirgan bo'lsa, zaxiradan qaytaramiz (bor fayllarga tegmaydi)
if [ -d "$backup" ]; then
  mkdir -p data
  if cp --help 2>&1 | grep -q -- '--update\[='; then cp -a --update=none "$backup/." data/; else cp -an "$backup/." data/; fi
fi

# 3. Qayta ishga tushirish
port="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"'"'"' ' || true)"
port="${port:-3000}"
check_url=""

docker_cmd() { if docker info >/dev/null 2>&1; then docker "$@"; else sudo -n docker "$@"; fi; }
pm2_name() {
  command -v pm2 >/dev/null || return 1
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const dir = process.argv[1];
        const p = JSON.parse(s).find(x => (x.pm2_env?.pm_cwd || "").replace(/\/+$/, "") === dir.replace(/\/+$/, ""));
        if (p) { console.log(p.name); return; }
      } catch {}
      process.exit(1);
    });' "$APP_DIR"
}

if [ -n "${RESTART_CMD:-}" ]; then
  log "Qayta ishga tushirish: $RESTART_CMD"
  npm ci --omit=dev --no-audit --no-fund
  bash -c "$RESTART_CMD"
  check_url="http://127.0.0.1:$port/api/health"
elif [ -f docker-compose.yml ] && [ -n "$(docker_cmd compose ps -q 2>/dev/null || true)" ]; then
  log "Docker: docker compose up -d --build"
  docker_cmd compose up -d --build
  docker_cmd image prune -f >/dev/null 2>&1 || true
elif systemctl list-unit-files agent-uz.service >/dev/null 2>&1 && systemctl is-enabled --quiet agent-uz 2>/dev/null; then
  log "systemd: agent-uz xizmati qayta ishga tushirilmoqda"
  npm ci --omit=dev --no-audit --no-fund
  sudo -n systemctl restart agent-uz
  check_url="http://127.0.0.1:$port/api/health"
elif name="$(pm2_name)"; then
  log "pm2: '$name' qayta ishga tushirilmoqda"
  npm ci --omit=dev --no-audit --no-fund
  pm2 restart "$name" --update-env
  check_url="http://127.0.0.1:$port/api/health"
else
  die "ilova qanday ishga tushirilgani aniqlanmadi (Docker, systemd 'agent-uz' yoki pm2 topilmadi). GitHub'da RESTART_CMD sirini yozing."
fi

# 4. Tekshiruv
if [ -n "$check_url" ]; then
  for i in $(seq 1 20); do
    if curl -fsS -o /dev/null "$check_url" 2>/dev/null; then log "Tayyor: ilova javob bermoqda ($new)"; exit 0; fi
    sleep 1
  done
  die "ilova qayta ishga tushgandan keyin javob bermayapti ($check_url). Loglarni tekshiring. Zaxira: $backup"
fi
log "Tayyor ($new)"
