# Antigravity / Gemini — Nortex

Lee primero `AGENTS.md` y después `CLAUDE.md`; ambas guías son obligatorias y tienen
precedencia sobre supuestos generales del modelo.

## Contexto local

- Runtime: Node `22.23.2` mediante `mise`; gestor de paquetes: npm.
- Repo canónico: `/Users/stark/Documents/GitHub/nortex.20`.
- Workspace operativo local: `/Users/stark/Developer/Nortex`.
- Verificación segura: `nortex check`.
- Servicios: `nortex backend` y `nortex n8n-up`, siempre ligados a loopback.
- Para cuentas individuales Google AI Pro/Ultra usa `agy`; Google retiró ese acceso
  de `gemini`. Antigravity conserva compatibilidad con este `GEMINI.md`.

## Límites para Gemini

- Empieza con una inspección de solo lectura y conserva el worktree sucio.
- No abras `.env*`, almacenes de credenciales ni llaves privadas.
- No uses herramientas web o shell para desplegar, llamar webhooks, modificar DNS,
  enviar mensajes, hacer push o fusionar ramas sin autorización explícita.
- No coloques `GEMINI_API_KEY` en el entorno del frontend: `vite.config.ts` puede
  incorporarla al bundle cliente. Las credenciales de IA pertenecen al backend o al
  almacén seguro de la herramienta.
- Para comandos destructivos o con efectos externos, detente y solicita confirmación.
- Ejecuta Antigravity inicialmente con `--mode plan --sandbox`. Nunca uses
  `--dangerously-skip-permissions` en Nortex.
- Mantén `useG1Credits=false`: al agotar la cuota incluida, espera su renovación. No
  habilites créditos de sobreconsumo ni una API key sin aprobación humana explícita.
- La autonomía inicial es `OBSERVE/PROPOSE`. Escribir en el repo canónico, enviar
  mensajes, mover dinero, tocar inventario o producción siempre requiere aprobación.
