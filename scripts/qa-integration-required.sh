#!/usr/bin/env bash
# Compuerta local de integración obligatoria para cambios de dinero o inventario.
#
# No reutiliza docker-compose ni una URL recibida del entorno: levanta MySQL 8
# efímero en tmpfs, backend loopback y cuentas sintéticas, y los elimina al salir.
set -Eeuo pipefail

qa_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$qa_root"

qa_die() {
    printf 'ERROR integración requerida: %s\n' "$1" >&2
    exit "${2:-1}"
}

qa_require() {
    command -v "$1" >/dev/null 2>&1 || qa_die "falta el prerrequisito local: $1"
}

qa_require docker
qa_require node
qa_require bash

qa_node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$qa_node_major" = '22' ] || qa_die "Nortex requiere Node 22; versión activa: $(node --version)"

[ -x node_modules/.bin/prisma ] || qa_die 'faltan dependencias locales; ejecutá npm ci antes de la compuerta.'
[ -x node_modules/.bin/tsx ] || qa_die 'falta tsx local; ejecutá npm ci antes de la compuerta.'
[ -x node_modules/.bin/vitest ] || qa_die 'falta Vitest local; ejecutá npm ci antes de la compuerta.'
docker info >/dev/null 2>&1 || qa_die 'Docker no está disponible localmente.'
docker image inspect mysql:8.0 >/dev/null 2>&1 \
    || qa_die 'No existe la imagen local mysql:8.0. Obtenela explícitamente antes de ejecutar esta compuerta.'

# Lista cerrada: si falta una suite nueva, el gate falla y obliga a registrarla.
qa_required_suites=(
    'tests/journalSingleConnection.mysql.test.ts'
    'tests/whatsappIdentity.mysql.test.ts'
    'tests/cashCloseJournal.mysql.test.ts'
    'tests/posIntegrity.integration.test.ts'
    'tests/manualCashMovementVoid.integration.test.ts'
    'tests/customerFlow.integration.test.ts'
    'tests/hrAccess.integration.test.ts'
    'tests/productRefresh.integration.test.ts'
    'tests/fiscalFlow.integration.test.ts'
    'tests/inventoryAdjust.integration.test.ts'
    'tests/batchWarehouseManualMovements.test.ts'
    'tests/procurementPhaseOne.integration.test.ts'
    'tests/procurementPhaseTwo.integration.test.ts'
    'tests/procurementPhaseTwoB.integration.test.ts'
    'tests/purchaseFlow.integration.test.ts'
    'tests/purchaseSalePrice.integration.test.ts'
    'tests/returnIdempotency.integration.test.ts'
    'tests/stockCountWarehouse.integration.test.ts'
    'tests/delivery.mysql.integration.test.ts'
)

for qa_suite in "${qa_required_suites[@]}"; do
    [ -f "$qa_suite" ] || qa_die "falta la suite obligatoria versionada: $qa_suite"
done

# Un archivo de integración nuevo tampoco puede quedar fuera de la lista por
# accidente: la lista es explícita para conservar el orden y el descubrimiento
# obliga a ampliar la compuerta en el mismo cambio.
while IFS= read -r qa_discovered_suite; do
    qa_registered=0
    for qa_suite in "${qa_required_suites[@]}"; do
        if [ "$qa_suite" = "$qa_discovered_suite" ]; then
            qa_registered=1
            break
        fi
    done
    [ "$qa_registered" = '1' ] \
        || qa_die "la suite de integración no está registrada en la compuerta: $qa_discovered_suite"
done < <(
    {
        find tests -type f \( -name '*.integration.test.ts' -o -name '*.mysql.test.ts' \) -print
        # Algunas rondas HTTP históricas no llevan el sufijo integration. Si
        # dependen de la URL QA, también son obligatorias: así no quedan
        # omitidas por convención de nombre.
        if command -v rg >/dev/null 2>&1; then
            rg -l 'process\.env\.(NORTEX_QA_BASE_URL|NORTEX_MYSQL_INTEGRATION)' tests --glob '*.test.ts' || true
        else
            grep -El 'process\.env\.(NORTEX_QA_BASE_URL|NORTEX_MYSQL_INTEGRATION)' tests/*.test.ts 2>/dev/null || true
        fi
    } | LC_ALL=C sort -u
)

qa_random() {
    node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
}

qa_key() {
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
}

qa_run_id="$(node -e "process.stdout.write(process.pid + '-' + require('node:crypto').randomBytes(8).toString('hex'))")"
qa_container="nortex-qa-required-${qa_run_id}"
qa_database='nortex_qa_required'
qa_user='nortex_qa_required'
qa_root_password="$(qa_random)"
qa_database_password="$(qa_random)"
qa_jwt_secret="$(qa_random)"
qa_data_key="$(qa_key)"
qa_ledger_key="$(qa_key)"
qa_index_key="$(qa_key)"
qa_tmp_dir="$(mktemp -d /tmp/nortex-qa-required.XXXXXX)"
qa_container_started=0
qa_server_pid=''
qa_database_port=''
qa_api_port=''

qa_cleanup() {
    qa_status=$?
    trap - EXIT HUP INT TERM

    if [ -n "$qa_server_pid" ] && kill -0 "$qa_server_pid" >/dev/null 2>&1; then
        kill "$qa_server_pid" >/dev/null 2>&1 || true
        for ((qa_wait = 0; qa_wait < 20; qa_wait += 1)); do
            kill -0 "$qa_server_pid" >/dev/null 2>&1 || break
            sleep 0.25
        done
        kill -0 "$qa_server_pid" >/dev/null 2>&1 && kill -9 "$qa_server_pid" >/dev/null 2>&1 || true
        wait "$qa_server_pid" >/dev/null 2>&1 || true
    fi

    if [ "$qa_container_started" = '1' ]; then
        docker rm -f "$qa_container" >/dev/null 2>&1 || true
    fi

    case "$qa_tmp_dir" in
        /tmp/nortex-qa-required.*) rm -rf -- "$qa_tmp_dir" ;;
        *) printf 'ERROR integración requerida: directorio temporal inesperado; no se eliminó.\n' >&2 ;;
    esac

    qa_root_password=''
    qa_database_password=''
    qa_jwt_secret=''
    qa_data_key=''
    qa_ledger_key=''
    qa_index_key=''
    exit "$qa_status"
}

qa_on_signal() {
    exit 130
}

trap qa_cleanup EXIT
trap qa_on_signal HUP INT TERM

qa_container_id="$(docker run -d --rm \
    --name "$qa_container" \
    --pull never \
    --tmpfs /var/lib/mysql \
    -p 127.0.0.1::3306 \
    -e "MYSQL_ROOT_PASSWORD=$qa_root_password" \
    -e "MYSQL_DATABASE=$qa_database" \
    -e "MYSQL_USER=$qa_user" \
    -e "MYSQL_PASSWORD=$qa_database_password" \
    mysql:8.0 \
    --default-authentication-plugin=mysql_native_password)"
[ -n "$qa_container_id" ] || qa_die 'no se pudo iniciar el contenedor MySQL efímero.'
qa_container_started=1

for ((qa_attempt = 1; qa_attempt <= 60; qa_attempt += 1)); do
    qa_database_port="$(docker port "$qa_container" 3306/tcp 2>/dev/null | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | sed -n '1p')"
    if [ -n "$qa_database_port" ] \
        && docker exec -e "MYSQL_PWD=$qa_database_password" "$qa_container" \
            mysqladmin ping -h 127.0.0.1 -u "$qa_user" --silent >/dev/null 2>&1; then
        break
    fi
    qa_database_port=''
    sleep 1
done
[ -n "$qa_database_port" ] || qa_die 'MySQL 8 efímero no quedó listo en 60 segundos.'

qa_database_url="mysql://${qa_user}:${qa_database_password}@127.0.0.1:${qa_database_port}/${qa_database}"

# El proceso recibe solo este entorno mínimo: ninguna clave heredada puede abrir
# correo, mensajería, LLM, pagos, telemetría o un backend externo.
env -i \
    PATH="$PATH" \
    DATABASE_URL="$qa_database_url" \
    NODE_ENV='test' \
    ./node_modules/.bin/prisma db push --schema backend/prisma/schema.prisma --skip-generate

qa_stop_backend() {
    if [ -n "$qa_server_pid" ] && kill -0 "$qa_server_pid" >/dev/null 2>&1; then
        kill "$qa_server_pid" >/dev/null 2>&1 || true
        wait "$qa_server_pid" >/dev/null 2>&1 || true
    fi
    qa_server_pid=''
}

qa_print_backend_failure() {
    printf '%s\n' 'ERROR integración requerida: log sanitario del backend QA:' >&2
    tail -n 80 "$qa_tmp_dir/backend.log" >&2 || true
}

qa_start_backend() {
    qa_api_port="$(node -e "const net=require('node:net'); const server=net.createServer(); server.listen(0, '127.0.0.1', () => { const address=server.address(); process.stdout.write(String(address.port)); server.close(); }); server.on('error', () => process.exit(1));")"
    [ -n "$qa_api_port" ] || qa_die 'no se pudo reservar un puerto loopback para el backend QA.'
    qa_base_url="http://127.0.0.1:${qa_api_port}"

    env -i \
        PATH="$PATH" \
        DATABASE_URL="$qa_database_url" \
        NODE_ENV='test' \
        JWT_SECRET="$qa_jwt_secret" \
        NORTEX_DATA_KEYS="qa:$qa_data_key" \
        NORTEX_LEDGER_KEYS="qa:$qa_ledger_key" \
        NORTEX_INDEX_KEY="$qa_index_key" \
        HOST='127.0.0.1' \
        PORT="$qa_api_port" \
        FRONTEND_URL="$qa_base_url" \
        WHATSAPP_ENABLED='false' \
        ./node_modules/.bin/tsx backend/server.ts >"$qa_tmp_dir/backend.log" 2>&1 &
    qa_server_pid=$!

    for ((qa_attempt = 1; qa_attempt <= 60; qa_attempt += 1)); do
        if env -i PATH="$PATH" node -e '
const url = process.argv[1];
fetch(url)
  .then(async (response) => {
    const body = await response.json();
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (response.status !== 200 || body?.ok !== true || body?.db !== "up" || !cacheControl.includes("no-store")) process.exit(1);
  })
  .catch(() => process.exit(1));
' "$qa_base_url/api/health"; then
            return
        fi
        if ! kill -0 "$qa_server_pid" >/dev/null 2>&1; then
            qa_print_backend_failure
            qa_die 'el backend QA se detuvo antes de responder saludable.'
        fi
        sleep 1
    done
    qa_print_backend_failure
    qa_die 'el backend QA no respondió /api/health sano en 60 segundos.'
}

for qa_suite in "${qa_required_suites[@]}"; do
    qa_start_backend
    qa_report="$qa_tmp_dir/$(basename "$qa_suite").json"
    printf 'Ejecutando integración requerida: %s\n' "$qa_suite"

    env -i \
        PATH="$PATH" \
        DATABASE_URL="$qa_database_url" \
        NODE_ENV='test' \
        JWT_SECRET="$qa_jwt_secret" \
        NORTEX_DATA_KEYS="qa:$qa_data_key" \
        NORTEX_LEDGER_KEYS="qa:$qa_ledger_key" \
        NORTEX_INDEX_KEY="$qa_index_key" \
        NORTEX_MYSQL_INTEGRATION='1' \
        NORTEX_QA_BASE_URL="$qa_base_url" \
        ./node_modules/.bin/vitest run "$qa_suite" --reporter=default --reporter=json --outputFile="$qa_report"

    env -i PATH="$PATH" node scripts/qa-verify-integration-report.mjs "$qa_report" "$qa_suite"
    qa_stop_backend
done

printf '%s\n' '✓ Integración requerida superada en MySQL 8 local, efímero y aislado.'
