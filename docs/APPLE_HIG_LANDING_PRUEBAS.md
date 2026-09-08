# Apple HIG — Pruebas de Landing y uso de skills (Nortex)

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

## Pruebas realizadas (loop local, sin deploy)

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

## Estado — solo documentado

Preview en loop `http://127.0.0.1:4174/apple` es gris cálido aprobado, **no promovido**. Queda documentado para que un **agente de mayor frontera** (Claude Sonnet / GPT-5.4) lo aplique vía `engineering_change_v1` tras reposición de cuota, con revisión QA/seguridad y `human_owner` `AWAITING_APPROVAL`. Promoción futura: `cp components/LandingPage.apple.tsx components/LandingPage.tsx` + `nortex check`.

Ver `control-plane/artifacts/apple-hig-skill-uso-y-pruebas-2026-08-28.md` para checklist HIG completo.
