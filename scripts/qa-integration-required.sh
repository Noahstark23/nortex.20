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

# Un solo registro compartido por el wrapper y el runner. El verificador lee
# las suites y falla si falta una, aparece otra sin registrar o no puede leerla.
qa_registered="$(env -i PATH="$PATH" node scripts/verify-quality-suite-registration.mjs)" \
    || qa_die 'el registro de suites obligatorias no coincide con las pruebas locales.'
[ -n "$qa_registered" ] || qa_die 'el registro de suites obligatorias está vacío.'

qa_random() {
    node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
}

qa_run_id="$(node -e "process.stdout.write(process.pid + '-' + require('node:crypto').randomBytes(8).toString('hex'))")"
qa_container="nortex-qa-required-${qa_run_id}"
qa_database='nortex_qa_required'
qa_user='nortex_qa_required'
qa_root_password="$(qa_random)"
qa_database_password="$(qa_random)"
qa_container_started=0
qa_runner_pid=''
qa_database_port=''

qa_cleanup() {
    qa_status=$?
    trap - EXIT HUP INT TERM

    if [ -n "$qa_runner_pid" ] && kill -0 "$qa_runner_pid" >/dev/null 2>&1; then
        kill "$qa_runner_pid" >/dev/null 2>&1 || true
        for ((qa_wait = 0; qa_wait < 20; qa_wait += 1)); do
            kill -0 "$qa_runner_pid" >/dev/null 2>&1 || break
            sleep 0.25
        done
        kill -0 "$qa_runner_pid" >/dev/null 2>&1 && kill -9 "$qa_runner_pid" >/dev/null 2>&1 || true
        wait "$qa_runner_pid" >/dev/null 2>&1 || true
    fi

    if [ "$qa_container_started" = '1' ]; then
        docker rm -f "$qa_container" >/dev/null 2>&1 || true
    fi

    qa_root_password=''
    qa_database_password=''
    exit "$qa_status"
}

qa_on_signal() {
    exit 130
}

trap qa_cleanup EXIT
trap qa_on_signal HUP INT TERM

qa_container_id="$(MYSQL_ROOT_PASSWORD="$qa_root_password" MYSQL_DATABASE="$qa_database" MYSQL_USER="$qa_user" MYSQL_PASSWORD="$qa_database_password" docker run -d --rm \
    --name "$qa_container" \
    --pull never \
    --tmpfs /var/lib/mysql \
    -p 127.0.0.1::3306 \
    -e MYSQL_ROOT_PASSWORD \
    -e MYSQL_DATABASE \
    -e MYSQL_USER \
    -e MYSQL_PASSWORD \
    mysql:8.0 \
    --default-authentication-plugin=mysql_native_password \
    --log-bin-trust-function-creators=1)"
[ -n "$qa_container_id" ] || qa_die 'no se pudo iniciar el contenedor MySQL efímero.'
qa_container_started=1

for ((qa_attempt = 1; qa_attempt <= 60; qa_attempt += 1)); do
    qa_database_port="$(docker port "$qa_container" 3306/tcp 2>/dev/null | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | sed -n '1p')"
    if [ -n "$qa_database_port" ] \
        && MYSQL_PWD="$qa_database_password" docker exec -e MYSQL_PWD "$qa_container" \
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
    ./node_modules/.bin/prisma generate --schema backend/prisma/schema.prisma

env -i \
    PATH="$PATH" \
    DATABASE_URL="$qa_database_url" \
    NODE_ENV='test' \
    ./node_modules/.bin/prisma db push --schema backend/prisma/schema.prisma --skip-generate

# El runner compartido conserva la identidad sanitaria por corrida, reinicia el
# backend por suite, activa solo capacidades sintéticas y retira explícitamente
# toda credencial del proveedor. Es el único motor que ejecuta las 37 suites.
env -i \
    PATH="$PATH" \
    DATABASE_URL="$qa_database_url" \
    NORTEX_QA_DATABASE_ACK='disposable-database' \
    NODE_ENV='test' \
    node scripts/run-quality-integration.mjs &
qa_runner_pid=$!
wait "$qa_runner_pid"
qa_runner_pid=''

printf '%s\n' '✓ Integración requerida superada en MySQL 8 local, efímero y aislado.'
