# Apple HIG — historial y estado verificable de la superficie pública

> **Estado al 2026-09-05:** lo que sigue conserva un experimento histórico.
> No es una receta de despliegue ni autoriza staging, producción, push o merge.
> La evidencia visual actual y sus límites están en
> [AUDITORIA_VISUAL_2026-09-05.md](AUDITORIA_VISUAL_2026-09-05.md).

## Archivo histórico (2026-08-28)

**Fecha:** 2026-08-28 — **Repo:** `nortex.20` — **Estación:** `Developer/Nortex` (`OFFLINE_SUPERVISED`)

## Registro histórico no ejecutable

El experimento de 2026-08-28 instaló skills externas y propuso una landing
separada, con una variante oscura inicial. Sus comandos, rutas y copias de
componentes se retiraron de este archivo para que ningún agente los tome como
instrucción vigente. Tampoco se conserva `?apple=1` como mecanismo de revisión.

Las reglas vigentes para agentes están en `AGENTS.md` y `CLAUDE.md`; el alcance,
la evidencia y los límites de esta superficie están en
`docs/AUDITORIA_VISUAL_2026-09-05.md`. Cualquier nueva revisión visual debe
partir de esos documentos y del checkout actual, no de esta bitácora.

**Iteraciones:**
1. Dark `#0B0D10` — feedback: horrible, fuera de meta
2. Clara `#fff`/`#f5f5f7` apple.com — feedback: quema la vista
3. Gris cálido `#ececf0`/`#e8e8ed` texto `#1d1d1f` — feedback: aprobado

## Estado histórico — sustituido

La afirmación histórica de que `/apple` estaba «no promovido» ya no describe el
producto actual. No copiar archivos ni usar este texto como receta: consultar el
estado vigente y la auditoría enlazada al inicio.

## Estado vigente y contratos que no se deben degradar

- La experiencia SPA de `/` y la ruta de compatibilidad `/apple` usan
  `components/public/PublicHomePage.tsx`; `/apple` ya no es una variante aislada
  que deba copiarse sobre otra landing. No usar `?apple=1`: dejó de ser un
  contrato de ruta.
- La raíz de producción sirve `dist/landing.html`, generado desde
  `public/landing.html`. Es un renderizador estático deliberado para SEO, no una
  señal de que el SPA se haya omitido. Conserva contenido indexable, JSON-LD,
  canonical y enlaces públicos.
- `/login`, `/register`, `/forgot-password` y reset comparten
  `components/auth/AuthShell.tsx`; el selector Día/Noche usa `workspaceTheme` y
  se vuelve a asociar a tenant/usuario cuando existe una sesión completa.

El modo Día es el valor inicial; Día/Noche es un único control accesible y no
borra el formulario. Texto escrito, placeholder, cursor y autofill deben
mantener contraste en ambas superficies. La landing estática conserva skip link,
tabs y teclado; no se sustituye con HTML oculto ni se duplica JSON-LD.

Antes de una promoción, ejecutar los checks de superficie pública y revisar una
sesión anónima de `/`, `landing.html`, `/login` y `/register` en Día/Noche con
texto sintético. Nunca usar credenciales reales para esta revisión.
