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

if [ "${NORTEX_SCHEMA_ONLY_FOR_CI:-0}" = "1" ] \
  && [ "${GITHUB_ACTIONS:-false}" != "true" ]; then
  echo "❌ NORTEX_SCHEMA_ONLY_FOR_CI solo se permite dentro de GitHub Actions."
  exit 1
fi

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

# 2 · Aplicar parches DDL explícitos y luego sincronizar el schema. Prisma marca
#     algunos cambios expand-only (por ejemplo, un UNIQUE nuevo) como posible
#     data loss y se niega a aplicarlos sin un flag global peligroso. El preflight
#     state-based solo ejecuta DDL conocido, valida datos/definición y converge
#     desde estados parciales; jamás borra o corrige filas automáticamente.
#
#     Reintentar unas pocas veces cubre el lapso entre "puerto abierto" y "MySQL
#     listo para auth". Cada comando tiene timeout externo para que un metadata
#     lock no congele el deploy. Los estados inseguros (exit 42), timeouts y
#     cualquier warning que pida --accept-data-loss fallan inmediatamente.
ATTEMPTS="${DB_PUSH_ATTEMPTS:-6}"
SCHEMA_SYNC_TIMEOUT_SECONDS="${SCHEMA_SYNC_TIMEOUT_SECONDS:-120}"
case "$SCHEMA_SYNC_TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    echo "❌ SCHEMA_SYNC_TIMEOUT_SECONDS debe ser un entero entre 5 y 1800."
    exit 1
    ;;
esac
if [ "$SCHEMA_SYNC_TIMEOUT_SECONDS" -lt 5 ] || [ "$SCHEMA_SYNC_TIMEOUT_SECONDS" -gt 1800 ]; then
  echo "❌ SCHEMA_SYNC_TIMEOUT_SECONDS debe estar entre 5 y 1800."
  exit 1
fi
i=1
DB_PUSH_LOG="$(mktemp /tmp/nortex-db-push.XXXXXX)"
cleanup_db_push_log() { rm -f "$DB_PUSH_LOG"; }
trap cleanup_db_push_log EXIT HUP INT TERM
run_schema_command() {
  node scripts/run-with-timeout.mjs "$SCHEMA_SYNC_TIMEOUT_SECONDS" "$@"
}

while :; do
  PREFLIGHT_STATUS=0
  run_schema_command npm run db:preflight || PREFLIGHT_STATUS=$?

  if [ "$PREFLIGHT_STATUS" -eq 42 ]; then
    echo "❌ Preflight abortado: el schema o los datos requieren intervención manual."
    echo "   No se ejecutó db push ni se modificaron filas automáticamente."
    exit 1
  fi

  if [ "$PREFLIGHT_STATUS" -eq 124 ]; then
    echo "❌ Preflight excedió ${SCHEMA_SYNC_TIMEOUT_SECONDS}s (posible metadata lock)."
    echo "   Error no reintentable en este deploy; revisar transacciones abiertas."
    exit 1
  fi

  if [ "$PREFLIGHT_STATUS" -eq 0 ]; then
    DB_PUSH_STATUS=0
    run_schema_command npx prisma db push --schema="$SCHEMA" --skip-generate >"$DB_PUSH_LOG" 2>&1 || DB_PUSH_STATUS=$?
    sed -n '1,10000p' "$DB_PUSH_LOG"

    if [ "$DB_PUSH_STATUS" -eq 0 ]; then
      break
    fi

    if grep -Fq -- "--accept-data-loss" "$DB_PUSH_LOG"; then
      echo "❌ prisma db push detectó un cambio que exige --accept-data-loss."
      echo "   Es un error no reintentable: agregá un preflight DDL acotado o una migración versionada."
      echo "   El flag destructivo NO se habilita automáticamente."
      exit 1
    fi

    if [ "$DB_PUSH_STATUS" -eq 124 ]; then
      echo "❌ prisma db push excedió ${SCHEMA_SYNC_TIMEOUT_SECONDS}s (posible metadata lock)."
      echo "   Error no reintentable en este deploy; revisar transacciones abiertas."
      exit 1
    fi
  fi

  if [ "$i" -ge "$ATTEMPTS" ]; then
    echo "❌ Sincronización del schema falló tras $i intentos. Revisar el error real arriba."
    echo "   (P1001=sin conexión · P1000=credenciales · readonly=permisos del volumen ·"
    echo "    metadata lock/DDL=estado operativo). NO se arranca el server con la BD en mal estado."
    exit 1
  fi
  echo "… sincronización intento $i/$ATTEMPTS falló; reintentando en 5s."
  i=$((i + 1))
  sleep 5
done

cleanup_db_push_log
trap - EXIT HUP INT TERM

if [ "${NORTEX_SCHEMA_ONLY_FOR_CI:-0}" = "1" ]; then
  echo "✅ Modo CI: schema sincronizado; servidor omitido."
  exit 0
fi
echo "🚀 Schema aplicado. Arrancando el servidor."
exec env NODE_ENV=production npm run start
