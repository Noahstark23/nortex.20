#!/bin/sh
# NORTEX — Guard de comandos destructivos (PreToolUse sobre Bash).
#
# Este repo maneja dinero e inventario REALES de clientes. Un comando de más no
# se deshace con un ctrl+Z. Cada patrón de acá salió de un incidente concreto o
# de una regla explícita del CLAUDE.md, no de una lista genérica de internet.
#
# Protocolo: exit 2 BLOQUEA y le devuelve el stderr al agente para que corrija.
#
# OJO con los falsos positivos: el guard hace substring sobre la línea entera, así
# que un `grep "accept-data-loss"` de auditoría, o escribir documentación sobre
# estos patrones, quedaría bloqueado sin que haya ningún riesgo. (Pasó la primera
# vez que se probó este mismo hook.) Por eso los comandos de SOLA LECTURA se
# eximen antes de mirar los patrones: leer nunca destruyó nada.

cmd=$(python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
[ -z "$cmd" ] && exit 0

# El cuerpo de un heredoc es DATO, no comando: escribir un mensaje de commit o un
# documento que MENCIONE `--accept-data-loss` no borra nada. La primera versión de
# este guard bloqueó su propio commit por eso. Se examina solo lo que está antes
# del `<<`, que es la línea de comando de verdad.
cmd=${cmd%%<<*}

# ── Eximir inspección de sola lectura ────────────────────────────────────────
# Solo si el comando ARRANCA con la herramienta: `grep x && rm -rf /` no se exime
# porque el prefijo se evalúa sobre el comando completo, no por segmento.
case "$cmd" in
  grep\ *|rg\ *|cat\ *|head\ *|tail\ *|less\ *|wc\ *|ls\ *|find\ *|echo\ *|printf\ *)
    case "$cmd" in *"&&"*|*";"*|*"|"*|*'`'*|*'$('*) ;; *) exit 0 ;; esac ;;
  "git log"*|"git show"*|"git diff"*|"git status"*|"git ls-tree"*)
    case "$cmd" in *"&&"*|*";"*|*"|"*) ;; *) exit 0 ;; esac ;;
esac

bloquear() {
  echo "🛑 BLOQUEADO por .claude/hooks/guard-bash.sh" >&2
  echo "   $1" >&2
  echo "   Si era una inspección de sola lectura, corré el comando sin encadenarlo." >&2
  exit 2
}

case "$cmd" in
  # El deploy corre `db push` SIN esa bandera a propósito: un cambio no aditivo
  # debe HACER FALLAR el arranque (la instancia vieja sigue sirviendo) en vez de
  # borrar datos de producción. Ver CLAUDE.md, guardrail 8.
  *--accept-data-loss*)
    bloquear "Esa bandera borra datos de producción. El schema es estrictamente aditivo." ;;
  *"prisma migrate reset"*|*"migrate reset"*)
    bloquear "migrate reset destruye la base entera." ;;
  *"DROP DATABASE"*|*"DROP TABLE"*|*"TRUNCATE "*|*"drop database"*|*"drop table"*)
    bloquear "DDL destructivo sobre la base." ;;
  *"rm -rf /"*|*"rm -rf ~"*)
    bloquear "Borrado recursivo de una raíz." ;;

  # El incidente real: `git add -A` tras un npm install commiteó un
  # package-lock.json podado (739 líneas menos, @capacitor/cli entre ellas), el
  # `npm ci` del CI instaló desde ese lockfile y tsc falló en TODOS los PRs
  # abiertos hasta que se restauró. Los archivos se agregan por nombre.
  "git add -A"*|"git add ."*|"git add --all"*)
    bloquear "git add -A/. commiteó una vez un lockfile podado y rompió el CI de main. Agregá los archivos por nombre." ;;

  # main es la rama compartida; reescribirle la historia rompe a todos.
  *push*--force*main*|*"push -f"*main*)
    bloquear "Force-push a main." ;;
esac
exit 0
