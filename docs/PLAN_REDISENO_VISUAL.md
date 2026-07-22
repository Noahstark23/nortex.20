# Plan — Rediseño visual: que Nortex no parezca hecho por IA

> Estado: **plan aprobable** · Rama `claude/rediseno-visual`
> Insumos: investigación de skills (agente 1) + auditoría de diseño del frontend
> real (agente 2). Herramienta instalada: skill oficial **`frontend-design`** de
> Anthropic, vendoreada en `.claude/skills/frontend-design/` (se activa sola en
> trabajo frontend).

## 1. Diagnóstico (de la auditoría, con evidencia)

**El titular:** Nortex NO carece de sistema de diseño — tiene uno bueno y
deliberado ("Obsidian": `brand` índigo #6366f1, Plus Jakarta Sans + JetBrains
Mono para montos, sombras premium, primitivas `.panel-premium`/`.btn-primary`
en `index.css`). El look de IA viene de que está **aplicado a medias**:

1. **Dos mundos de luz**: el chrome (sidebar, login) es Obsidian oscuro, pero
   13 pantallas — incluidas las de mayor uso: POS (`bg-slate-100`),
   CashRegisters, Dashboard, HRM, Reports — quedaron claras estilo viejo.
   El cajero alterna oscuro→claro→oscuro sin lógica.
2. **La marca es minoría en su propio código**: paleta default de Tailwind
   >2,400 usos vs ~516 de tokens de marca. `blue-*` (419 usos) es el azul
   genérico de IA por excelencia. Dos verdes (emerald+green), dos azules
   (blue+indigo), dos grises (slate+gray) compitiendo.
3. **302 emojis como íconos** en una app que ya usa lucide-react
   (`'💵 Inyección de Capital'` junto a `<Wallet/>`).
4. **212 tokens de gradiente** — `from-blue-600 to-indigo-600`,
   `from-amber-500 to-orange-500`: el cliché del generador.
5. **El botón primario no existe como decisión**: 5 estilos conviviendo
   (emerald/blue/indigo/gradiente/btn-primary — este último en solo 6 archivos;
   `input-premium` definida y usada 0 veces).
6. **Modales sin estándar**: 67 claros vs 5 oscuros, ~10 backdrops distintos.
7. **234 `uppercase` + 119 `tracking-wider`**: el label "corporate SaaS"
   mecánico.
8. **La landing es otra marca**: Inter + Instrument Serif + azul #3b82f6 +
   clara, vs SPA con Jakarta + índigo + oscuro.
9. **Assets rotos**: favicon.svg referenciado pero **inexistente**,
   `apple-touch-icon.png` y `og-image.png` MISSING (preview de WhatsApp/FB
   roto), manifest PWA con colores slate viejos y `lang: "en"`; el "logo" es
   un `<span>N</span>` — los JPG de `logos/` no se usan en ningún lado.

## 2. Brief de diseño (obligatorio por la skill `frontend-design`)

- **Sujeto**: ERP/POS para dueños de ferreterías, pulperías y farmacias de
  Nicaragua que manejan dinero e inventario reales, 8 horas al día.
- **Audiencia**: comerciantes prácticos, no técnicos; celular de gama media y
  desktop modesto; español nica (voseo).
- **Dirección estética**: **"herramienta profesional de confianza"** — sobria,
  densa donde hay datos, cero decoración sin propósito. La app maneja plata:
  la intencionalidad vale más que la audacia.
- **Sistema (ya existe, se termina de imponer)**: Obsidian oscuro como ÚNICO
  mundo · índigo `brand` = acción/primario · verde `nortex-accent` = dinero
  que entra/éxito · ámbar = advertencia/deuda · rojo = peligro/salida ·
  TODO monto en JetBrains Mono `tabular-nums`.
- **Elemento firma**: **el número sagrado** — las cifras de dinero como
  protagonistas tipográficas (mono, tabulares, jerarquía de tamaño), que ya
  es el lenguaje del panóptico. Nadie más en el mercado nica trata así los
  números.
- **Lo que se elimina**: emojis en UI, gradientes en botones/headers, paleta
  default (blue/green/gray/purple/sky sueltos), UPPERCASE mecánico.

**Decisión que necesita al CEO**: la recomendación es **Obsidian oscuro en
toda la app** (ya es el chrome, es la identidad declarada y diferencia del
SaaS genérico claro). Alternativa: todo claro — mismo esfuerzo, menos
identidad. El plan asume oscuro.

## 3. Roadmap

### Fase 1 — Cimientos (quick wins, 1 PR, sin tocar 40 componentes)
- **Remapear la paleta default en `tailwind.config.js`** (la misma palanca que
  ya se usó con `slate`): `blue`/`indigo`/`sky`/`violet` → escala `brand`;
  `green` → escala `nortex-accent`; `gray` → escala obsidiana. Recolorea
  cientos de usos sin editar JSX y mata el "azul IA" de un golpe.
- **Assets de marca**: `favicon.svg` real (la N en índigo), `apple-touch-icon.png`,
  `og-image.png` (los previews sociales hoy están rotos), manifest PWA con
  `theme_color`/`background_color` de Obsidian y `lang: "es"`.
- **Primitivas de imposición**: shell único de modal (`.modal-backdrop` +
  `.modal-panel`) y botón primario canónico; documentar en `index.css` cuál
  es LA forma.
- **Purga de emojis visibles** → íconos lucide (labels del POS y compañía).
- QA: build + screenshots antes/después (`run-nortex`) + regresión visual de
  las 5 pantallas Obsidian existentes (no deben cambiar).

### Fase 2 — El flujo del cajero (cirugía, 1 PR)
- **POS.tsx a Obsidian**: la pantalla de 8 h/día. Fondo/superficies/inputs al
  sistema, fuera gradientes, montos en mono, jerarquía tipográfica real.
- **CashRegisters.tsx a Obsidian**: fuera las tarjetas pastel
  (emerald-50/blue-50/indigo-50...), panóptico con la semántica de color fija.
- Verificación con screenshots desktop + móvil de cada pantalla.

### Fase 3 — El resto del ERP (2-3 PRs por lotes)
- Lote A: Dashboard, MiNegocio (quitar rainbow de KPIs → semántica fija),
  Reports, FinancialHealth.
- Lote B: HRM, Contabilidad, Clients, Billing, AccountsReceivable,
  QuotationManager, AuditDashboard, DeliveryManager.
- Checklist de conversión por pantalla (fondo, superficies, botones, modales,
  labels, montos en mono, cero default-palette).

### Fase 4 — Landing ↔ producto (1 PR)
- Unificar identidad: Plus Jakarta Sans + índigo `brand` también en
  `public/landing.html`/`landing.css` (hoy: Inter/serif/azul).
- La landing puede quedarse clara (es marketing) pero con la MISMA paleta y
  tipografía; CTA índigo, no gradiente verde.
- Regenerar OG/screenshots del prerender si aplica.

## 4. Método
Cada fase = rama + PR draft con el loop `nortex-feature`, con la skill
`frontend-design` cargada, y QA visual: `run-nortex` + screenshots
antes/después en el PR. Nada de re-estilizar y romper: cero cambios de
lógica/handlers en los diffs de estilo.

## 5. Fuera de alcance
- Rebrand del nombre/logo profesional (se necesita un diseñador humano para el
  logotipo final; acá se hace un wordmark digno con la N + tipografía).
- Librerías nuevas de UI (nada de shadcn/MUI: el bundle ya roza el límite del
  PWA y Tailwind alcanza).
- Modo claro/oscuro conmutables (una sola identidad primero; toggle después
  si el mercado lo pide).
