#!/bin/sh
set -eu

task_container='nortex-mysql-dev'
task_host='127.0.0.1'
task_port='3307'
task_backend_port='3230'
task_frontend_port='4185'
task_mode='run'
task_tmp_dir=''
task_database_url=''
task_jwt_secret=''
task_mysql_password=''
task_run_suffix=''
task_database=''
task_user=''
task_backend_pid=''
task_frontend_pid=''

while [ "$#" -gt 0 ]; do
    case "$1" in
        --serve)
            task_mode='serve'
            ;;
        *)
            printf 'Uso: %s [--serve]\n' "$0" >&2
            exit 1
            ;;
    esac
    shift
done

assert_port_free() {
    task_check_port="$1"
    task_check_label="$2"
    task_listener=$(lsof -t -nP -iTCP:"$task_check_port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$task_listener" ]; then
        printf 'El puerto %s para %s ya esta ocupado por PID(s): %s\n' \
            "$task_check_port" "$task_check_label" "$task_listener" >&2
        exit 1
    fi
}

if ! docker ps --format '{{.Names}}' | grep -qx "$task_container"; then
    printf 'El contenedor dev %s no esta activo. Ejecuta: nortex db-up\n' "$task_container" >&2
    exit 1
fi

assert_port_free "$task_backend_port" 'backend QA Delivery'
if [ "$task_mode" = 'serve' ]; then
    assert_port_free "$task_frontend_port" 'frontend QA Delivery'
fi

task_run_suffix=$(mise exec node@22.23.2 -- node -e "process.stdout.write(require('node:crypto').randomBytes(4).toString('hex'))")
task_database="nortex_delivery_${task_run_suffix}"
task_user="nortex_delivery_${task_run_suffix}"
task_mysql_password=$(mise exec node@22.23.2 -- node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")
task_jwt_secret=$(mise exec node@22.23.2 -- node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
task_tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/nortex-delivery-qa.XXXXXX")

root_mysql() {
    docker exec -i "$task_container" sh -eu -c '
        task_root_password=$(tr -d "\r\n" < /run/secrets/mysql_root_password)
        export MYSQL_PWD="$task_root_password"
        task_root_password=""
        exec mysql --protocol=socket -uroot --batch --skip-column-names
    '
}

cleanup() {
    if [ -n "$task_frontend_pid" ] && kill -0 "$task_frontend_pid" 2>/dev/null; then
        kill "$task_frontend_pid" 2>/dev/null || true
        wait "$task_frontend_pid" 2>/dev/null || true
    fi
    if [ -n "$task_backend_pid" ] && kill -0 "$task_backend_pid" 2>/dev/null; then
        kill "$task_backend_pid" 2>/dev/null || true
        wait "$task_backend_pid" 2>/dev/null || true
    fi
    {
        printf 'DROP DATABASE IF EXISTS `%s`;\n' "$task_database"
        printf "DROP USER IF EXISTS '%s'@'%%';\n" "$task_user"
    } | root_mysql >/dev/null 2>&1 || true
    case "$task_tmp_dir" in
        "${TMPDIR:-/tmp}"/nortex-delivery-qa.*)
            [ ! -d "$task_tmp_dir" ] || rm -rf -- "$task_tmp_dir"
            ;;
    esac
    task_mysql_password=''
    task_jwt_secret=''
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

{
    printf 'DROP DATABASE IF EXISTS `%s`;\n' "$task_database"
    printf "DROP USER IF EXISTS '%s'@'%%';\n" "$task_user"
    printf 'CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n' "$task_database"
    printf "CREATE USER '%s'@'%%' IDENTIFIED WITH mysql_native_password BY '%s';\n" "$task_user" "$task_mysql_password"
    printf "GRANT ALL PRIVILEGES ON \`%s\`.* TO '%s'@'%%';\n" "$task_database" "$task_user"
} | root_mysql >/dev/null

task_database_url="mysql://${task_user}:${task_mysql_password}@${task_host}:${task_port}/${task_database}"

wait_for_http() {
    task_url="$1"
    task_label="$2"
    task_log="$3"
    task_attempt=0
    while [ "$task_attempt" -lt 120 ]; do
        if curl --silent --fail "$task_url" >/dev/null 2>&1; then
            return 0
        fi
        if [ -f "$task_log" ] && ! kill -0 "${4:-0}" 2>/dev/null; then
            printf 'Fallo al iniciar %s. Revisa %s\n' "$task_label" "$task_log" >&2
            exit 1
        fi
        task_attempt=$((task_attempt + 1))
        sleep 1
    done
    printf 'Tiempo agotado esperando %s en %s\n' "$task_label" "$task_url" >&2
    exit 1
}

printf 'Preparando schema efimero Delivery en MySQL 8 dev...\n'
DATABASE_URL="$task_database_url" mise exec node@22.23.2 -- npx --no-install prisma db push \
    --schema backend/prisma/schema.prisma \
    --skip-generate

task_backend_log="$task_tmp_dir/backend.log"
printf 'Levantando backend QA Delivery en 127.0.0.1:%s...\n' "$task_backend_port"
env \
    DATABASE_URL="$task_database_url" \
    JWT_SECRET="$task_jwt_secret" \
    JWT_SECRETS="$task_jwt_secret" \
    HOST='127.0.0.1' \
    PORT="$task_backend_port" \
    FRONTEND_URL="http://127.0.0.1:${task_frontend_port}" \
    NODE_ENV='test' \
    RESEND_API_KEY='' \
    SENTRY_DSN='' \
    STRIPE_SECRET_KEY='' \
    STRIPE_PRICE_ID='' \
    STRIPE_WEBHOOK_SECRET='' \
    WHATSAPP_ENABLED='false' \
    WHATSAPP_APP_SECRET='' \
    WHATSAPP_VERIFY_TOKEN='' \
    ANTHROPIC_API_KEY='' \
    SOURCE_COMMIT='local-delivery-qa' \
    mise exec node@22.23.2 -- npm run start >"$task_backend_log" 2>&1 &
task_backend_pid=$!
wait_for_http "http://127.0.0.1:${task_backend_port}/api/health" 'backend QA Delivery' "$task_backend_log" "$task_backend_pid"

printf 'Ejecutando QA Delivery MySQL real...\n'
DATABASE_URL="$task_database_url" \
NORTEX_QA_BASE_URL="http://127.0.0.1:${task_backend_port}" \
NORTEX_MYSQL_INTEGRATION=1 \
mise exec node@22.23.2 -- npx --no-install vitest run tests/delivery.mysql.integration.test.ts

if [ "$task_mode" = 'serve' ]; then
    task_frontend_log="$task_tmp_dir/frontend.log"
    printf 'Levantando frontend QA Delivery en 127.0.0.1:%s...\n' "$task_frontend_port"
    env \
        NORTEX_DEV_API_TARGET="http://127.0.0.1:${task_backend_port}" \
        mise exec node@22.23.2 -- npm run dev -- --host 127.0.0.1 --port "$task_frontend_port" --strictPort >"$task_frontend_log" 2>&1 &
    task_frontend_pid=$!
    wait_for_http "http://127.0.0.1:${task_frontend_port}" 'frontend QA Delivery' "$task_frontend_log" "$task_frontend_pid"

    printf 'Sembrando pedido visual sintetico pendiente...\n'
    env \
        DATABASE_URL="$task_database_url" \
        NORTEX_QA_BASE_URL="http://127.0.0.1:${task_backend_port}" \
        NORTEX_VISUAL_EMAIL='qa-delivery-visual@example.invalid' \
        NORTEX_VISUAL_PASSWORD='Qa-Delivery-Visual-9!' \
        mise exec node@22.23.2 -- node --input-type=module <<'EOF'
import crypto from 'node:crypto';

const baseUrl = process.env.NORTEX_QA_BASE_URL;
const visualEmail = process.env.NORTEX_VISUAL_EMAIL;
const visualPassword = process.env.NORTEX_VISUAL_PASSWORD;
if (!baseUrl) throw new Error('NORTEX_QA_BASE_URL no esta definido');
if (!visualEmail || !visualPassword) throw new Error('Faltan credenciales sinteticas visuales');

const api = async (path, token = '', init = {}) => {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
};

const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const registration = await api('/api/auth/register', '', {
  method: 'POST',
  body: JSON.stringify({
    companyName: `QA Delivery Visual ${runId}`,
    email: visualEmail,
    password: visualPassword,
    type: 'MISCELANEA',
  }),
});
const token = registration.token;
const slug = registration.tenant.slug || `qa-delivery-visual-${runId}`.toLowerCase();
if (!registration.tenant.slug) {
  await api('/api/tenant/slug', token, {
    method: 'PUT',
    body: JSON.stringify({ slug }),
  });
}
const product = await api('/api/products', token, {
  method: 'POST',
  body: JSON.stringify({
    name: `QA Delivery Visual Producto ${runId}`,
    sku: `QA-DELIVERY-VISUAL-${runId}`.toUpperCase(),
    category: 'QA Delivery Visual',
    price: '25.00',
    cost: '10.00',
    stock: '10',
    minStock: '0',
    unit: 'unidad',
    saleMode: 'COUNTED',
    quantityStep: '1',
    isPublished: true,
    requiresBatchTracking: false,
    ivaExento: false,
  }),
});
const pedido = await api('/api/v1/pedidos', '', {
  method: 'POST',
  body: JSON.stringify({
    slug,
    clienteNombre: `Cliente Visual ${runId}`,
    clienteTelefono: '88885678',
    direccionEntrega: 'Altamira, del porton principal 2c al lago',
    referenciaDireccion: 'Casa blanca QA',
    notas: 'Pedido pendiente para inspeccion visual local',
    items: [{ productoId: product.id, cantidad: '2', presentation: 'BASE' }],
  }),
});

console.log(`Frontend: http://127.0.0.1:4185`);
console.log(`Backend health: ${baseUrl}/api/health`);
console.log(`Usuario sintetico: ${visualEmail}`);
console.log(`Slug catalogo: ${slug}`);
console.log(`Pedido pendiente: ${pedido.pedidoId}`);
EOF

    printf 'Entorno visual listo. Presiona Ctrl-C para limpiar backend, frontend, BD y usuario efimeros.\n'
    while :; do
        sleep 60
    done
fi

printf 'QA Delivery MySQL completado; backend, BD y usuario efimeros se eliminaran ahora.\n'
