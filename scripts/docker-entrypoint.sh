#!/bin/sh
# NORTEX — Arranque resiliente del contenedor de la app.
#
# Problema que resuelve: el CMD anterior encadenaba `prisma db push && npm start`
# con `&&`. Si MySQL todavía no aceptaba conexiones (el `depends_on` de compose NO
# espera readiness, solo que el contenedor exista), `db push` fallaba, el server
# nunca arrancaba y el contenedor salía con error → Docker reintentaba → mismo
# fallo → se quemaba el límite de 10 restarts. (Ver PR de deploy resiliente.)
#
# Diseño: (1) esperar a que la DB acepte conexiones TCP; (2) aplicar el schema con
# unos pocos reintentos para absorber la ventana de primer arranque de MySQL
# (puerto abierto pero aún no listo para auth). Si el `db push` falla de forma
# PERSISTENTE (credenciales, volumen readonly, o un cambio destructivo de schema),
# el script sale con el error real de Prisma en los logs — NO lo enmascara.
set -e

SCHEMA="backend/prisma/schema.prisma"

# 1 · Esperar conectividad TCP con la base de datos (host/puerto salen de DATABASE_URL).
echo "⏳ Esperando conectividad con la base de datos…"
node -e '
const net = require("net");
const u = new URL(process.env.DATABASE_URL);
const host = u.hostname, port = Number(u.port) || 3306;
const deadline = Date.now() + (Number(process.env.DB_WAIT_SECONDS || 120) * 1000);
(function attempt() {
  const s = net.connect(port, host);
  s.once("connect", () => { s.end(); console.log("✅ DB acepta conexiones en " + host + ":" + port); process.exit(0); });
  s.once("error", () => {
    s.destroy();
    if (Date.now() > deadline) { console.error("❌ Timeout esperando a la DB en " + host + ":" + port); process.exit(1); }
    setTimeout(attempt, 2000);
  });
})();
'

# 2 · Aplicar el schema (DDL puro, aditivo). Reintentar unas pocas veces cubre el
#     lapso entre "puerto abierto" y "MySQL listo para auth" en el primer arranque.
ATTEMPTS="${DB_PUSH_ATTEMPTS:-6}"
i=1
until npx prisma db push --schema="$SCHEMA" --skip-generate; do
  if [ "$i" -ge "$ATTEMPTS" ]; then
    echo "❌ prisma db push falló tras $i intentos. Revisar el error de Prisma arriba"
    echo "   (P1001=sin conexión · P1000=credenciales · readonly=permisos del volumen ·"
    echo "    cambio destructivo=schema no aditivo). NO se arranca el server con la BD en mal estado."
    exit 1
  fi
  echo "… db push intento $i/$ATTEMPTS falló (¿MySQL aún iniciando?). Reintentando en 5s."
  i=$((i + 1))
  sleep 5
done

echo "🚀 Schema aplicado. Arrancando el servidor."
exec env NODE_ENV=production npm run start
