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

bloquear() {
  echo "🛑 BLOQUEADO por .claude/hooks/guard-bash.sh" >&2
  echo "   $1" >&2
  echo "   Si era una inspección de sola lectura, corré el comando sin encadenarlo." >&2
  exit 2
}

# La entrada del hook es un contrato de seguridad, no una sugerencia. Si JSON o
# Python fallan, o si el comando contiene controles/varias líneas, no se puede
# aplicar una excepción de lectura con seguridad. Bloquear antes de que la
# sustitución de comando pueda recortar un salto de línea final.
if ! cmd=$(python3 -c '
import json
import sys

payload = json.load(sys.stdin)
tool_input = payload.get("tool_input")
if not isinstance(tool_input, dict):
    raise ValueError("tool_input_required")
command = tool_input.get("command")
if not isinstance(command, str):
    raise ValueError("command_required")
if any(ord(char) < 32 or ord(char) == 127 for char in command):
    raise ValueError("control_character")
if command[:1].isspace():
    raise ValueError("leading_whitespace")
sys.stdout.write(command)
' 2>/dev/null); then
  bloquear "No se pudo interpretar de forma segura el comando recibido."
fi
[ -z "$cmd" ] && exit 0

# Defensa en profundidad para entradas que pudieran cambiar de representación
# entre el parser y el shell. Nunca se recortan espacios para intentar hacerlas
# pasar por una lectura: se rechazan.
case "$cmd" in
  [[:space:]]*)
    bloquear "Un comando no puede comenzar con espacios ni controles." ;;
esac

# Un heredoc puede contener terminadores y nuevos comandos después de la primera
# línea. Recortarlo antes de inspeccionarlo permitía esconder una mutación tras el
# terminador. Este hook no necesita ejecutar heredocs de agentes, por lo que ante
# cualquier `<<` falla cerrada en lugar de intentar interpretar sintaxis de shell.
case "$cmd" in
  *"<<"*)
    bloquear "Los heredocs no se permiten en comandos de agentes: pueden ocultar una mutación después de su terminador." ;;
esac

# Devuelve `unsafe` si una herramienta que parece de lectura contiene sintaxis de
# shell que puede encadenar, redirigir o sustituir otro comando. El parser mínimo
# respeta comillas: `rg 'a > b'` sigue siendo una lectura, pero
# `cat AGENTS.md > otro-archivo` no puede esconder una escritura detrás de `cat`.
lectura_con_sintaxis_de_shell() {
  printf '%s' "$cmd" | python3 -c '
import sys

text = sys.stdin.read()
quote = None
i = 0
unsafe = False
while i < len(text):
    char = text[i]
    if quote == "\047":
        if char == "\047":
            quote = None
    elif quote == "\042":
        if char == "\\\\":
            i += 1
        elif char == "\042":
            quote = None
        elif char == "`" or (char == "$" and i + 1 < len(text) and text[i + 1] == "("):
            unsafe = True
            break
    elif char == "\\\\":
        i += 1
    elif char in ("\047", "\042"):
        quote = char
    elif char in ";|&><`" or (char == "$" and i + 1 < len(text) and text[i + 1] == "("):
        unsafe = True
        break
    i += 1

print("unsafe" if unsafe else "safe")
' 2>/dev/null
}

# No se aceptan cadenas, pipes, sustituciones ni redirecciones en el comando que
# llega al hook. Una herramienta aparentemente inocua no debe poder ocultar un
# segundo comando o una escritura detrás de esa sintaxis. Las lecturas simples con
# el símbolo dentro de comillas se conservan: el parser anterior distingue ese caso.
[ "$(lectura_con_sintaxis_de_shell)" = "safe" ] \
  || bloquear "El comando contiene sintaxis de shell que puede encadenar o redirigir una mutación."

# ── Eximir inspección de sola lectura ────────────────────────────────────────
# La exención sirve únicamente para una lectura simple. No permitir redirecciones,
# pipes, sustituciones o encadenamientos: antes permitían que un `cat`/`find` de
# apariencia inocente modificara archivos.
case "$cmd" in
  grep\ *|rg\ *|cat\ *|head\ *|tail\ *|less\ *|wc\ *|ls\ *|echo\ *|printf\ *|"git log"*|"git show"*|"git diff"*|"git status"*|"git ls-tree"*)
    [ "$(lectura_con_sintaxis_de_shell)" = "safe" ] \
      || bloquear "Una lectura no puede incluir redirecciones, pipes, encadenamientos ni sustituciones."
    exit 0 ;;
  find\ *)
    [ "$(lectura_con_sintaxis_de_shell)" = "safe" ] \
      || bloquear "Una lectura no puede incluir redirecciones, pipes, encadenamientos ni sustituciones."
    case "$cmd" in
      *"-delete"*|*"-exec "*|*"-execdir "*|*"-ok "*|*"-okdir "*|*"-fprint "*|*"-fprint0 "*|*"-fprintf "*)
        bloquear "find con una acción de escritura no es una inspección de sola lectura." ;;
      *) exit 0 ;;
    esac ;;
esac

git_destructivo() {
  # `git -C <worktree> reset --hard` es tan destructivo como `git reset --hard`.
  # No alcanza con buscar las palabras adyacentes: Git acepta opciones globales
  # antes del subcomando y también puede recibirlo dentro de `sh -c`. Se tokeniza
  # sin ejecutar nada y se vuelve a inspeccionar una capa de argumentos de shell.
  # Un texto mal formado falla cerrado porque no se puede demostrar que sea seguro.
  printf '%s' "$cmd" | python3 -c '
import os
import re
import shlex
import sys

DESTRUCTIVE = {"clean", "reset", "checkout", "switch", "restore"}
OPTIONS_WITH_VALUE = {
    "-C", "-c", "--config-env", "--exec-path", "--git-dir",
    "--namespace", "--super-prefix", "--work-tree",
}
ALIAS_CAPABLE_OPTIONS = {"-c", "--config-env"}

def destructive_subcommand(tokens):
    for index, token in enumerate(tokens):
        if os.path.basename(token).lower() != "git":
            continue
        cursor = index + 1
        while cursor < len(tokens):
            candidate = tokens[cursor]
            if candidate == "--":
                cursor += 1
                break
            # Una configuración inyectada en la propia invocación puede definir
            # `alias.nuke=reset` y esconder el subcomando real. El hook no tiene
            # que interpretar aliases: cualquier `-c` o `--config-env` de Git se
            # rechaza antes de que pueda cambiar la semántica del resto.
            if candidate in ALIAS_CAPABLE_OPTIONS or candidate.startswith("--config-env="):
                return True
            if candidate in OPTIONS_WITH_VALUE:
                cursor += 2
                continue
            if candidate.startswith("-"):
                cursor += 1
                continue
            if candidate in DESTRUCTIVE:
                return True
            # Tampoco se permite sembrar un alias persistente que podría usar
            # una invocación posterior para disfrazar una mutación de checkout.
            if candidate == "config" and any(part.lower().startswith("alias.") for part in tokens[cursor + 1:]):
                return True
            return False
    return False

def contains_destructive_git(text, depth=0):
    if depth > 4:
        return True
    try:
        tokens = shlex.split(text, posix=True)
    except ValueError:
        return True
    # Git también acepta aliases desde variables de entorno (`GIT_CONFIG_COUNT`,
    # `GIT_CONFIG_KEY_0`, etc.). Una configuración así puede convertir `git nuke`
    # en `git reset --hard`; por tanto no se admite ningún `GIT_CONFIG_*` junto a
    # una invocación de Git dentro de este guard.
    has_git = any(os.path.basename(token).lower() == "git" for token in tokens)
    if has_git and any(re.match(r"^GIT_CONFIG_[A-Za-z0-9_]+=", token, re.IGNORECASE) for token in tokens):
        return True
    if destructive_subcommand(tokens):
        return True
    return any(
        "git" in token and token != text and contains_destructive_git(token, depth + 1)
        for token in tokens
    )

try:
    command = sys.stdin.read()
    sys.exit(0 if contains_destructive_git(command) else 1)
except Exception:
    sys.exit(0)
' 2>/dev/null
}

if git_destructivo; then
  bloquear "No limpies, resetees, restaures ni cambies de rama sin una operación aislada y autorizada."
fi

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
  # OJO con el patrón: `"git add ."*` matcheaba `git add .claude/hooks/x.sh`,
  # que es JUSTO lo que esta regla quiere (un archivo por nombre, que además
  # empieza con punto). El `.` tiene que ser un argumento COMPLETO — solo o
  # seguido de espacio—, no el primer carácter de una ruta.
  "git add -A"|"git add -A "*|"git add ."|"git add . "*|"git add --all"|"git add --all "*)
    bloquear "git add -A/. commiteó una vez un lockfile podado y rompió el CI de main. Agregá los archivos por nombre." ;;

  # main es la rama compartida; reescribirle la historia rompe a todos.
  *push*--force*main*|*"push -f"*main*)
    bloquear "Force-push a main." ;;
esac
exit 0
