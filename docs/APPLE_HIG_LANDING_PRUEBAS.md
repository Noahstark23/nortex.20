# Apple HIG — historial y estado verificable de la superficie pública

> **Estado al 2026-09-05:** lo que sigue conserva un experimento histórico.
> No es una receta de despliegue ni autoriza staging, producción, push o merge.
> La evidencia visual actual y sus límites están en
> [AUDITORIA_VISUAL_2026-09-05.md](AUDITORIA_VISUAL_2026-09-05.md).

## Archivo histórico (2026-08-28)

**Fecha:** 2026-08-28 — **Repo:** `nortex.20` — **Estación:** `Developer/Nortex` (`OFFLINE_SUPERVISED`)

## Instalación de skills (global OpenCode)

```sh
git clone https://github.com/Ksanbal/apple-hig-codex-skill.git ~/.agents/apple-hig-codex-skill
bash ~/.agents/apple-hig-codex-skill/install.sh
# → ~/.config/opencode/skills/apple-human-interface-guidelines/SKILL.md
# → ~/.claude/skills/apple-human-interface-guidelines/SKILL.md

git clone https://github.com/ehmo/platform-design-skills.git /tmp/platform-design-skills
for p in ios ipados macos watchos visionos tvos; do
  n=$(grep '^name:' /tmp/platform-design-skills/skills/$p/SKILL.md | awk '{print $2}')
  mkdir -p ~/.config/opencode/skills/$n
  cp /tmp/platform-design-skills/skills/$p/SKILL.md ~/.config/opencode/skills/$n/SKILL.md
  cp /tmp/platform-design-skills/skills/$p/metadata.json ~/.config/opencode/skills/$n/ 2>/dev/null || true
done
# → ios-design-guidelines (35K, 67 reglas), ipados, macos, watchos, visionos, tvos + Apple_HIG.pdf
# Validar: head -n 4 ~/.config/opencode/skills/*/SKILL.md | grep name
# Reiniciar opencode tras instalar.
```

## Uso (triggers por description)

```text
Use the apple-human-interface-guidelines skill. Review this app for iOS/iPadOS HIG alignment.
Use the ios-design-guidelines skill. Review this SwiftUI view for HIG compliance.
Use the macos-design-guidelines skill to add menu bar and keyboard shortcuts.
```

## Pruebas históricas (loop local, sin deploy)

**Método:** offline `DRAFT_LOCAL_ARTIFACT` (cuota `claude`/`openai` agotada, `antigravity` en cuarentena `SYNTHETIC_ONLY`). Artefactos en `Developer/Nortex/control-plane/artifacts/`:

- `apple-landing-proposal-2026-08-28.md` — diagnóstico + fixes
- `LandingPage.apple.proposal.tsx` — código dark inicial
- `components/LandingPage.apple.tsx` — copia viva
- `App.tsx:29` ruta `/apple`, `PublicLanding:264` toggle `?apple=1`

**Loop:**
```sh
mise exec "node@22.23.2" -- npm run dev -- --host 127.0.0.1 --port 4174
# → http://127.0.0.1:4174/apple  (Apple HIG)
# → http://127.0.0.1:4174/        (original)
# → http://127.0.0.1:4174/?apple=1 (forzado)
# HMR: [vite] hmr update /components/LandingPage.apple.tsx
```

**Iteraciones:**
1. Dark `#0B0D10` — feedback: horrible, fuera de meta
2. Clara `#fff`/`#f5f5f7` apple.com — feedback: quema la vista
3. Gris cálido `#ececf0`/`#e8e8ed` texto `#1d1d1f` — feedback: aprobado

## Estado histórico — sustituido

La afirmación histórica de que `/apple` estaba «no promovido» ya no describe el
producto actual. No copiar archivos ni usar este texto como receta: consultar el
estado vigente y la auditoría enlazada al inicio.

Ver `control-plane/artifacts/apple-hig-skill-uso-y-pruebas-2026-08-28.md` para el
checklist histórico completo.

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
