#!/usr/bin/env bash
#
# db-url.sh — Parseo de una URL `mysql://` a variables sueltas. Compartido por el
# backup y por la verificación de restauración: si cada script la parsea a su
# manera, un día difieren y el backup apunta a otra base.
#
# Uso:  source scripts/db-url.sh
#       parsear_url_mysql "$DATABASE_URL" DB   # → $DB_USER $DB_PASS $DB_HOST $DB_PORT $DB_NAME
#
# DOS TRAMPAS QUE ESTA FUNCIÓN RESUELVE (las dos daban un backup roto en silencio):
#
#  1. `@` en la contraseña. Cortar por el PRIMER `@` dejaba el host en
#     "ve#Rara@db" y el dump fallaba todas las noches contra un host inexistente.
#     El separador correcto es el ÚLTIMO `@`: todo lo de antes es la credencial.
#  2. Codificación porcentual. Prisma EXIGE que los caracteres especiales de la
#     URL vayan percent-encoded (`%40` por `@`, `%23` por `#`). Sin decodificar,
#     mysqldump recibía la contraseña literal "Cla%40ve" y no autenticaba.
#     (Consecuencia: un `%` literal en la contraseña también debe ir como `%25`,
#     que es justamente lo que Prisma pide.)
#
set -euo pipefail

url_decode() {
  # Los backslashes se protegen primero: `printf %b` los interpretaría como
  # escapes y corrompería la contraseña.
  local texto="${1//\\/\\\\}"
  printf '%b' "${texto//%/\\x}"
}

parsear_url_mysql() {
  local url="$1" prefijo="$2"
  local sin_proto creds hostpart hostport dbname port

  sin_proto="${url#*://}"
  creds="${sin_proto%@*}"        # todo hasta el ÚLTIMO @
  hostpart="${sin_proto##*@}"    # todo después del ÚLTIMO @
  hostport="${hostpart%%/*}"
  dbname="${hostpart#*/}"
  port="${hostport#*:}"
  [[ "$port" == "${hostport%%:*}" ]] && port=3306

  printf -v "${prefijo}_USER" '%s' "$(url_decode "${creds%%:*}")"
  printf -v "${prefijo}_PASS" '%s' "$(url_decode "${creds#*:}")"
  printf -v "${prefijo}_HOST" '%s' "${hostport%%:*}"
  printf -v "${prefijo}_PORT" '%s' "$port"
  printf -v "${prefijo}_NAME" '%s' "${dbname%%\?*}"
}
