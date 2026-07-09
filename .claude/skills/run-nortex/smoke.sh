#!/usr/bin/env bash
# NORTEX — driver de arranque + smoke E2E contra la app REAL (no la suite de tests).
# Uso:  bash .claude/skills/run-nortex/smoke.sh [--keep]
#   --keep  deja el server corriendo al final (para interactuar/screenshots extra)
# Hace: MySQL local → schema (db push) → build:seo → server prod → flujo real
# (registro → producto mayoreo/empaque → login → lectura) → screenshot → PASS/FAIL.
set -u
cd "$(dirname "$0")/../../.."   # → raíz del repo
PORT="${PORT:-3000}"
DB_URL="mysql://nortex:nortex123@localhost:3306/nortex"
OUT="${SMOKE_OUT:-/tmp/nortex-smoke}"; mkdir -p "$OUT"
PASS=0; FAIL=0
ok(){ echo "✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "✗ $1"; FAIL=$((FAIL+1)); }

echo "── 1/6 dependencias ──"
node -e "require('./node_modules/prisma/package.json')" 2>/dev/null || npm install >/dev/null 2>&1
V=$(npx prisma --version 2>/dev/null | grep -oE 'prisma *: *[0-9.]+' | grep -oE '[0-9.]+$')
[ "${V%%.*}" = "6" ] && ok "prisma $V (pinneado)" || bad "prisma $V — ¿corriste npm install? (npx baja v7 y rompe)"

echo "── 2/6 MySQL 8 local ──"
if ! mysqladmin status >/dev/null 2>&1; then
  which mysqld >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq mysql-server; }
  service mysql start >/dev/null 2>&1; sleep 3
fi
mysqladmin status >/dev/null 2>&1 && ok "mysqld arriba" || { bad "mysqld no arranca"; exit 1; }
mysql -e "CREATE DATABASE IF NOT EXISTS nortex; CREATE USER IF NOT EXISTS 'nortex'@'localhost' IDENTIFIED BY 'nortex123'; GRANT ALL ON nortex.* TO 'nortex'@'localhost'; FLUSH PRIVILEGES;" && ok "BD nortex lista"

echo "── 3/6 schema + build ──"
DATABASE_URL="$DB_URL" npx prisma db push --schema=backend/prisma/schema.prisma --skip-generate >/dev/null 2>&1 && ok "db push (DDL como el deploy real)" || bad "db push falló"
DATABASE_URL="$DB_URL" npx prisma generate --schema=backend/prisma/schema.prisma >/dev/null 2>&1
[ -f dist/landing.html ] || npm run build:seo >"$OUT/build.log" 2>&1
grep -q "Prerender" "$OUT/build.log" 2>/dev/null || [ -f dist/ferreterias/index.html ] && ok "build:seo (dist + prerender)" || bad "build:seo — ver $OUT/build.log"

echo "── 4/6 server ──"
pkill -f "tsx backend/server.ts" 2>/dev/null; sleep 1   # GOTCHA: matar el pid de npx deja al hijo node vivo dueño del puerto
DATABASE_URL="$DB_URL" JWT_SECRET="run-nortex-dev-secret" NODE_ENV=production PORT=$PORT \
  nohup npx tsx backend/server.ts >"$OUT/server.log" 2>&1 &
for i in $(seq 1 30); do grep -q "Ready" "$OUT/server.log" 2>/dev/null && break; sleep 1; done
grep -q "Ready" "$OUT/server.log" && ok "server Ready :$PORT" || { bad "server no arrancó — tail $OUT/server.log"; tail -5 "$OUT/server.log"; exit 1; }

echo "── 5/6 flujo real (API contra MySQL) ──"
EMAIL="smoke-$(date +%s)@nortex.test"
R=$(curl -s -X POST localhost:$PORT/api/auth/register -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Distribuidora Smoke\",\"email\":\"$EMAIL\",\"password\":\"Smoke1234\",\"type\":\"DISTRIBUIDORA\"}")
TOKEN=$(echo "$R" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch(e){console.log('')}})")
[ -n "$TOKEN" ] && ok "registro DISTRIBUIDORA → JWT" || bad "registro: $R"
P=$(curl -s -X POST localhost:$PORT/api/products -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Gaseosa 12oz","sku":"GAS-12","price":10,"cost":6,"stock":100,"wholesalePrice":8.5,"wholesaleMinQty":6,"packUnit":"caja","packSize":12,"packPrice":90}')
echo "$P" | grep -q '"packPrice":90' && ok "producto con mayoreo+empaque" || bad "producto: $(echo $P | head -c 120)"
curl -s -X POST localhost:$PORT/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Smoke1234\"}" | grep -q '"token"' && ok "login re-emite token" || bad "login falló"
curl -s "localhost:$PORT/api/products?search=Gaseosa" -H "Authorization: Bearer $TOKEN" | grep -q "Gaseosa 12oz" && ok "lectura tenant-scoped" || bad "lectura"
[ "$(curl -s localhost:$PORT/ | grep -c 'Tu negocio ya vende')" = "1" ] && ok "landing.html en /" || bad "landing"
curl -s localhost:$PORT/ferreterias | grep -q "<title>Software para Ferreterías" && ok "prerender por-ruta" || bad "prerender"
NLOC=$(curl -s localhost:$PORT/sitemap.xml | grep -c "<loc>"); [ "$NLOC" -ge 70 ] && ok "sitemap ($NLOC URLs)" || bad "sitemap ($NLOC)"

echo "── 6/6 screenshot GUI ──"
CHROME=$(find /opt/pw-browsers -name chrome -type f 2>/dev/null | head -1)
if [ -n "$CHROME" ]; then
  "$CHROME" --headless --disable-gpu --no-sandbox --screenshot="$OUT/login.png" --window-size=1280,800 \
    "http://localhost:$PORT/login" >/dev/null 2>&1
  [ -s "$OUT/login.png" ] && ok "screenshot → $OUT/login.png" || bad "screenshot vacío"
else
  echo "· chromium no encontrado en /opt/pw-browsers — screenshot omitido"
fi

echo; echo "═══ RESULTADO: $PASS PASS · $FAIL FAIL ═══"
if [ "${1:-}" = "--keep" ]; then echo "server corriendo en :$PORT (pkill -f 'tsx backend/server.ts' para parar)"; else pkill -f "tsx backend/server.ts" 2>/dev/null; echo "server detenido"; fi
[ "$FAIL" = "0" ]
