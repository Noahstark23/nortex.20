#!/bin/sh
set -eu

# Integracion PR-01 exclusivamente contra el MySQL 8 local de desarrollo.
# Crea credenciales y base efimeras; el trap limpia incluso si Prisma/Vitest falla.
task_container='nortex-mysql-dev'
task_database='nortex_pr01_mysql_it'
task_user='nortex_pr01_it'
task_host='127.0.0.1'
task_port='3307'

if ! docker ps --format '{{.Names}}' | grep -qx "$task_container"; then
    printf 'El contenedor dev %s no esta activo. Ejecuta: nortex db-up\n' "$task_container" >&2
    exit 1
fi

task_password=$(mise exec -- node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")

root_mysql() {
    docker exec -i "$task_container" sh -eu -c '
        task_root_password=$(tr -d "\r\n" < /run/secrets/mysql_root_password)
        export MYSQL_PWD="$task_root_password"
        task_root_password=""
        exec mysql --protocol=socket -uroot --batch --skip-column-names
    '
}

cleanup() {
    {
        printf 'DROP DATABASE IF EXISTS `%s`;\n' "$task_database"
        printf "DROP USER IF EXISTS '%s'@'%%';\n" "$task_user"
    } | root_mysql >/dev/null 2>&1 || true
    task_password=''
}
trap cleanup EXIT HUP INT TERM

# Los identificadores son constantes; la contrasena es hex aleatoria y nunca se imprime.
{
    printf 'DROP DATABASE IF EXISTS `%s`;\n' "$task_database"
    printf "DROP USER IF EXISTS '%s'@'%%';\n" "$task_user"
    printf 'CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n' "$task_database"
    printf "CREATE USER '%s'@'%%' IDENTIFIED WITH mysql_native_password BY '%s';\n" "$task_user" "$task_password"
    printf "GRANT ALL PRIVILEGES ON \`%s\`.* TO '%s'@'%%';\n" "$task_database" "$task_user"
} | root_mysql >/dev/null

task_database_url="mysql://${task_user}:${task_password}@${task_host}:${task_port}/${task_database}"

printf 'Preparando schema efimero PR-01 en MySQL 8 dev...\n'
DATABASE_URL="$task_database_url" mise exec -- npx --no-install prisma db push \
    --schema backend/prisma/schema.prisma \
    --skip-generate

printf 'Ejecutando concurrencia real de cierre y journal...\n'
DATABASE_URL="$task_database_url" \
NORTEX_MYSQL_INTEGRATION=1 \
mise exec -- npx --no-install vitest run tests/cashCloseJournal.mysql.test.ts

printf 'Smoke MySQL PR-01 completado; la BD y el usuario efimeros se eliminaran ahora.\n'
