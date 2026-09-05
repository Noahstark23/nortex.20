#!/usr/bin/env bash
# Smoke de Nortex contra recursos propios, efímeros y sintéticos.
#
# Nunca instala ni arranca MySQL del sistema, no toca DATABASE_URL/puertos del
# llamante y no mata procesos por nombre. Solo puede borrar el contenedor y el
# grupo de procesos etiquetados/creados por esta ejecución.
set -Eeuo pipefail
umask 077

smoke_usage() {
    cat <<'EOF'
Uso: mise exec -- bash .claude/skills/run-nortex/smoke.sh

Ejecuta un smoke local aislado con MySQL 8 efímero. Requiere Docker local y la
imagen mysql:8.0 ya disponible. No acepta --keep ni parámetros de conexión.
EOF
}

smoke_die() {
    printf 'ERROR smoke aislado: %s\n' "$1" >&2
    exit "${2:-1}"
}

case "$#:${1:-}" in
    '0:') ;;
    '1:--help'|'1:-h')
        smoke_usage
        exit 0
        ;;
    '1:--keep')
        smoke_die '--keep fue retirado: el smoke nunca deja una BD ni un servidor activos.' 64
        ;;
    *)
        smoke_usage >&2
        smoke_die 'argumento no admitido; no se aceptan puertos, URL ni credenciales.' 64
        ;;
esac

smoke_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$smoke_root"

smoke_require() {
    command -v "$1" >/dev/null 2>&1 || smoke_die "falta el prerrequisito local: $1"
}

# El contexto se lee sin overrides del llamante. Un socket Unix local es la
# única forma permitida: un daemon TCP/SSH podría ser infraestructura ajena.
smoke_docker() {
    env -u DOCKER_HOST -u DOCKER_CONTEXT docker "$@"
}

smoke_require bash
smoke_require node
smoke_require docker
smoke_require curl
smoke_require ps
smoke_require tr

smoke_node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$smoke_node_major" = '22' ] || smoke_die "Nortex requiere Node 22; versión activa: $(node --version)"

for smoke_bin in prisma tsx vite; do
    [ -x "node_modules/.bin/$smoke_bin" ] \
        || smoke_die "falta el binario local $smoke_bin; prepará dependencias con npm ci antes del smoke."
done

smoke_docker_context="$(smoke_docker context show 2>/dev/null)" \
    || smoke_die 'Docker no está disponible localmente.'
smoke_docker_host="$(smoke_docker context inspect "$smoke_docker_context" --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" \
    || smoke_die 'No se pudo validar el contexto Docker.'
case "$smoke_docker_host" in
    unix:///*) ;;
    *) smoke_die 'El smoke solo permite un daemon Docker por socket Unix local.' ;;
esac
smoke_docker info >/dev/null 2>&1 || smoke_die 'Docker no está disponible localmente.'
smoke_docker image inspect mysql:8.0 >/dev/null 2>&1 \
    || smoke_die 'No existe la imagen local mysql:8.0. Obtenela explícitamente antes de ejecutar este smoke.'

smoke_env() {
    # No heredar claves que habiliten correo, pagos, LLM, telemetría, webhooks
    # o conexiones de una persona operadora. PATH basta para los binarios locales.
    env -i PATH="$PATH" "$@"
}

smoke_random() {
    node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
}

smoke_run_id="$(node -e "process.stdout.write(process.pid + '-' + require('node:crypto').randomBytes(8).toString('hex'))")"
smoke_suffix="$(node -e "process.stdout.write(require('node:crypto').randomBytes(8).toString('hex'))")"
smoke_container="nortex-run-smoke-${smoke_run_id}"
smoke_database="nortex_smoke_${smoke_suffix}"
smoke_user="nortex_smoke_${smoke_suffix}"
smoke_root_password="$(smoke_random)"
smoke_database_password="$(smoke_random)"
smoke_jwt_secret="$(smoke_random)"
smoke_tmp_dir="$(mktemp -d /tmp/nortex-run-smoke.XXXXXX)"
smoke_container_id=''
smoke_container_started=0
smoke_server_pid=''
smoke_server_pgid=''
smoke_server_group_owned=0
smoke_database_port=''
smoke_api_port=''

smoke_stop_owned_server() {
    [ "$smoke_server_group_owned" = '1' ] || return 0
    [ -n "$smoke_server_pgid" ] || return 0

    # El grupo se crea con `set -m` y debe estar liderado por el PID que este
    # script acaba de recibir. Solo entonces se señaliza ese grupo propio.
    if kill -0 -- "-$smoke_server_pgid" >/dev/null 2>&1; then
        kill -TERM -- "-$smoke_server_pgid" >/dev/null 2>&1 || true
        for ((smoke_wait = 0; smoke_wait < 20; smoke_wait += 1)); do
            kill -0 -- "-$smoke_server_pgid" >/dev/null 2>&1 || break
            sleep 0.25
        done
        kill -0 -- "-$smoke_server_pgid" >/dev/null 2>&1 \
            && kill -KILL -- "-$smoke_server_pgid" >/dev/null 2>&1 || true
    fi

    wait "$smoke_server_pid" >/dev/null 2>&1 || true
    smoke_server_group_owned=0
}

smoke_cleanup() {
    smoke_status=$?
    trap - EXIT HUP INT TERM

    smoke_stop_owned_server

    if [ "$smoke_container_started" = '1' ] && [ -n "$smoke_container_id" ]; then
        smoke_owner="$(smoke_docker inspect --format '{{ index .Config.Labels "com.nortex.smoke.run" }}' "$smoke_container_id" 2>/dev/null || true)"
        if [ "$smoke_owner" = "$smoke_run_id" ]; then
            smoke_docker rm -f "$smoke_container_id" >/dev/null 2>&1 || true
        else
            printf '%s\n' 'ADVERTENCIA smoke aislado: el contenedor no coincidió con su etiqueta; no se eliminó.' >&2
        fi
    fi

    case "$smoke_tmp_dir" in
        /tmp/nortex-run-smoke.*) rm -rf -- "$smoke_tmp_dir" ;;
        *) printf '%s\n' 'ADVERTENCIA smoke aislado: directorio temporal inesperado; no se eliminó.' >&2 ;;
    esac

    smoke_root_password=''
    smoke_database_password=''
    smoke_jwt_secret=''
    exit "$smoke_status"
}

smoke_on_signal() {
    exit 130
}

trap smoke_cleanup EXIT
trap smoke_on_signal HUP INT TERM

smoke_group_alive() {
    [ "$smoke_server_group_owned" = '1' ] \
        && kill -0 -- "-$smoke_server_pgid" >/dev/null 2>&1
}

smoke_check_health() {
    curl --fail --silent --show-error --max-time 3 \
        --output "$smoke_tmp_dir/health.json" \
        "$smoke_base_url/api/health" >/dev/null 2>&1 \
        && smoke_env node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (body?.ok !== true || body?.db !== "up") process.exit(1);
' "$smoke_tmp_dir/health.json"
}

smoke_extract_token() {
    smoke_env node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (typeof body?.token !== "string" || body.token.length < 20) process.exit(1);
process.stdout.write(body.token);
' "$1"
}

printf '%s\n' '── 1/6 precondiciones locales ──'
printf '%s\n' '✓ Node 22, binarios locales, Docker Unix local y mysql:8.0 disponibles'

printf '%s\n' '── 2/6 MySQL 8 temporal y aislado ──'
smoke_container_id="$(smoke_docker run -d --rm \
    --name "$smoke_container" \
    --label "com.nortex.smoke.run=$smoke_run_id" \
    --pull never \
    --tmpfs /var/lib/mysql \
    -p 127.0.0.1::3306 \
    -e "MYSQL_ROOT_PASSWORD=$smoke_root_password" \
    -e "MYSQL_DATABASE=$smoke_database" \
    -e "MYSQL_USER=$smoke_user" \
    -e "MYSQL_PASSWORD=$smoke_database_password" \
    mysql:8.0 \
    --default-authentication-plugin=mysql_native_password)" \
    || smoke_die 'no se pudo iniciar el contenedor MySQL efímero.'
[ -n "$smoke_container_id" ] || smoke_die 'Docker no devolvió el identificador del contenedor MySQL.'
smoke_container_started=1

for ((smoke_attempt = 1; smoke_attempt <= 60; smoke_attempt += 1)); do
    smoke_database_port="$(smoke_docker port "$smoke_container_id" 3306/tcp 2>/dev/null \
        | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | sed -n '1p')"
    if [ -n "$smoke_database_port" ] \
        && smoke_docker exec -e "MYSQL_PWD=$smoke_database_password" "$smoke_container_id" \
            mysqladmin ping -h 127.0.0.1 -u "$smoke_user" --silent >/dev/null 2>&1; then
        break
    fi
    smoke_database_port=''
    sleep 1
done
[ -n "$smoke_database_port" ] || smoke_die 'MySQL 8 efímero no quedó listo en 60 segundos.'
smoke_database_url="mysql://${smoke_user}:${smoke_database_password}@127.0.0.1:${smoke_database_port}/${smoke_database}"
printf '%s\n' '✓ MySQL 8 propio listo en un puerto loopback aleatorio'

printf '%s\n' '── 3/6 schema descartable y build local ──'
smoke_env \
    DATABASE_URL="$smoke_database_url" \
    NODE_ENV='test' \
    ./node_modules/.bin/prisma db push --schema backend/prisma/schema.prisma --skip-generate \
    >"$smoke_tmp_dir/schema.log" 2>&1 \
    || smoke_die 'el schema no pudo aplicarse a la base temporal.'
smoke_env \
    NODE_ENV='production' \
    ./node_modules/.bin/vite build \
    >"$smoke_tmp_dir/build.log" 2>&1 \
    || smoke_die 'el build local falló.'
smoke_env \
    NODE_ENV='production' \
    ./node_modules/.bin/tsx scripts/prerender.ts \
    >>"$smoke_tmp_dir/build.log" 2>&1 \
    || smoke_die 'el prerender local falló.'
[ -f dist/landing.html ] && [ -f dist/sitemap.xml ] \
    || smoke_die 'el build no produjo landing y sitemap locales.'
printf '%s\n' '✓ schema descartable, build y prerender locales'

printf '%s\n' '── 4/6 backend propio en loopback ──'
smoke_api_port="$(smoke_env node -e '
const net = require("node:net");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(String(address.port));
  server.close();
});
server.on("error", () => process.exit(1));
')" || smoke_die 'no se pudo seleccionar un puerto loopback para el backend.'
[ -n "$smoke_api_port" ] || smoke_die 'no se pudo seleccionar un puerto loopback para el backend.'
smoke_base_url="http://127.0.0.1:${smoke_api_port}"

# Job control crea un grupo separado que se valida antes de usarlo en cleanup.
# Así no se señaliza por nombre ni se toca un proceso que este smoke no haya creado.
set -m
smoke_env \
    DATABASE_URL="$smoke_database_url" \
    NODE_ENV='production' \
    JWT_SECRET="$smoke_jwt_secret" \
    HOST='127.0.0.1' \
    PORT="$smoke_api_port" \
    FRONTEND_URL="$smoke_base_url" \
    WHATSAPP_ENABLED='false' \
    WHATSAPP_LLM='disabled' \
    RESEND_API_KEY='' \
    STRIPE_SECRET_KEY='' \
    STRIPE_WEBHOOK_SECRET='' \
    ANTHROPIC_API_KEY='' \
    SENTRY_DSN='' \
    ./node_modules/.bin/tsx backend/server.ts \
    >"$smoke_tmp_dir/server.log" 2>&1 &
smoke_server_pid=$!
smoke_server_pgid="$(ps -o pgid= -p "$smoke_server_pid" | tr -d '[:space:]')"
if [ "$smoke_server_pgid" != "$smoke_server_pid" ]; then
    kill -TERM "$smoke_server_pid" >/dev/null 2>&1 || true
    wait "$smoke_server_pid" >/dev/null 2>&1 || true
    set +m
    smoke_die 'no se pudo aislar el grupo de proceso propio del backend.'
fi
smoke_server_group_owned=1
# Evita que Bash anuncie como fallo esperado la señal de limpieza; el grupo
# continúa identificado por su PGID propio y se comprueba antes de cada señal.
disown "$smoke_server_pid" || smoke_die 'no se pudo registrar el backend temporal como proceso propio.'
set +m

for ((smoke_attempt = 1; smoke_attempt <= 60; smoke_attempt += 1)); do
    smoke_check_health && break
    smoke_group_alive || smoke_die 'el backend temporal se detuvo antes de responder saludable.'
    sleep 1
done
smoke_check_health || smoke_die 'el backend temporal no respondió /api/health sano en 60 segundos.'
printf '%s\n' '✓ backend propio saludable solo en loopback'

printf '%s\n' '── 5/6 flujo sintético de la app real ──'
smoke_email="smoke-${smoke_suffix}@nortex.test"
smoke_login_password="$(smoke_random)"
printf '{"companyName":"Distribuidora Smoke","email":"%s","password":"%s","type":"DISTRIBUIDORA"}' \
    "$smoke_email" "$smoke_login_password" >"$smoke_tmp_dir/register.json"
curl --fail --silent --show-error --max-time 10 \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary "@$smoke_tmp_dir/register.json" \
    --output "$smoke_tmp_dir/register-response.json" \
    "$smoke_base_url/api/auth/register" >/dev/null 2>&1 \
    || smoke_die 'el registro sintético falló.'
smoke_token="$(smoke_extract_token "$smoke_tmp_dir/register-response.json")" \
    || smoke_die 'el registro sintético no devolvió un token válido.'
printf 'Authorization: Bearer %s\n' "$smoke_token" >"$smoke_tmp_dir/auth.headers"

printf '{"name":"Gaseosa 12oz","sku":"GAS-%s","price":10,"cost":6,"stock":100,"wholesalePrice":8.5,"wholesaleMinQty":6,"packUnit":"caja","packSize":12,"packPrice":90}' \
    "$smoke_suffix" >"$smoke_tmp_dir/product.json"
curl --fail --silent --show-error --max-time 10 \
    --request POST \
    --header 'Content-Type: application/json' \
    --header "@$smoke_tmp_dir/auth.headers" \
    --data-binary "@$smoke_tmp_dir/product.json" \
    --output "$smoke_tmp_dir/product-response.json" \
    "$smoke_base_url/api/products" >/dev/null 2>&1 \
    || smoke_die 'la creación del producto sintético falló.'
smoke_env node -e '
const fs = require("node:fs");
const product = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (Number(product?.packPrice) !== 90 || Number(product?.wholesalePrice) !== 8.5) process.exit(1);
' "$smoke_tmp_dir/product-response.json" \
    || smoke_die 'el producto sintético no conservó mayoreo y empaque.'

curl --fail --silent --show-error --max-time 10 \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary "@$smoke_tmp_dir/register.json" \
    --output "$smoke_tmp_dir/login-response.json" \
    "$smoke_base_url/api/auth/login" >/dev/null 2>&1 \
    || smoke_die 'el login sintético falló.'
smoke_extract_token "$smoke_tmp_dir/login-response.json" >/dev/null \
    || smoke_die 'el login sintético no devolvió un token válido.'

curl --fail --silent --show-error --max-time 10 \
    --header "@$smoke_tmp_dir/auth.headers" \
    --output "$smoke_tmp_dir/products-response.json" \
    "$smoke_base_url/api/products?search=Gaseosa" >/dev/null 2>&1 \
    || smoke_die 'la lectura tenant-scoped sintética falló.'
smoke_env node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!JSON.stringify(body).includes("Gaseosa 12oz")) process.exit(1);
' "$smoke_tmp_dir/products-response.json" \
    || smoke_die 'la lectura tenant-scoped no encontró el producto sintético.'

curl --fail --silent --show-error --max-time 10 \
    --output "$smoke_tmp_dir/landing.html" \
    "$smoke_base_url/" >/dev/null 2>&1 \
    || smoke_die 'la landing local no respondió.'
grep -Fq 'Tu negocio ya vende' "$smoke_tmp_dir/landing.html" \
    || smoke_die 'la raíz no sirvió la landing esperada.'
curl --fail --silent --show-error --max-time 10 \
    --output "$smoke_tmp_dir/ferreterias.html" \
    "$smoke_base_url/ferreterias" >/dev/null 2>&1 \
    || smoke_die 'la ruta prerenderizada local no respondió.'
grep -Fq '<title>Software para Ferreterías' "$smoke_tmp_dir/ferreterias.html" \
    || smoke_die 'la ruta prerenderizada no conservó su título.'
curl --fail --silent --show-error --max-time 10 \
    --output "$smoke_tmp_dir/sitemap.xml" \
    "$smoke_base_url/sitemap.xml" >/dev/null 2>&1 \
    || smoke_die 'el sitemap local no respondió.'
smoke_sitemap_locations="$(grep -c '<loc>' "$smoke_tmp_dir/sitemap.xml" || true)"
[ "$smoke_sitemap_locations" -ge 70 ] \
    || smoke_die 'el sitemap local no contiene el mínimo esperado de URLs.'
printf '%s\n' '✓ registro, producto, login, lectura tenant-scoped, landing, prerender y sitemap sintéticos'

printf '%s\n' '── 6/6 limpieza estricta ──'
printf '%s\n' '✓ al salir se eliminan únicamente los recursos creados por este smoke'
printf '%s\n' '═══ RESULTADO: smoke aislado superado ═══'
