# Plan UX Simple — "que un mono pueda vender"

**Misión:** Nortex lo van a usar ferreteros, señoras de pulpería y farmacéuticos —
no gente de computadoras. La experiencia debe ser fácil y rápida por defecto,
con el poder completo disponible para quien lo busque (*progressive disclosure*).

## Diagnóstico (verificado en código)

1. **Menú "talla única":** un dueño de pulpería veía ~17 módulos en 6 grupos
   (Contabilidad NIIF, Auditoría, Salud Financiera, B2B, RRHH…). El sistema ya
   sabe el giro (`tenant.type`) pero no lo usaba para simplificar — solo LENDER
   tenía menú propio (4 items), la prueba de que el enfoque funciona.
2. **Primera pantalla = dashboard financiero denso**, no la acción del día.
   Hasta el cajero aterrizaba en el dashboard en vez del POS.
3. **Jerga:** "Cotizaciones", "CRM", "Arqueos", "Cuentas por cobrar". La señora
   de la pulpería cobra **el fiado**.
4. **Pantallas gigantes** (POS 168KB, Inventario 134KB): todo visible a la vez
   cuando el 90% del uso son 3 acciones.
5. **Bases ya construidas para aprovechar:** onboarding auto-checklist, tours
   driver.js, gating por rol, `QuickAddProduct`.

## Las 5 fases (PRs secuenciales)

### ✅ Fase A — Menú según el negocio + Modo Simple (este PR)
- `utils/navigation.ts` (módulo puro): catálogo + `buildNavigation({tenantType,
  role, simple})` → `{primary, more, homePath}`.
- Sets simples por giro: PULPERIA 4 items · FERRETERIA 6 · FARMACIA 5 ·
  DISTRIBUIDORA 7 · resto 5. Todo lo demás queda plegado en **"Más opciones"**
  (nada desaparece: `primary ∪ more` = menú completo del rol).
- Toggle **"Ver menú simple / completo"** persistido (`nortex_ui_mode`).
  Default: simple SOLO para PULPERIA; el resto conserva el menú completo.
- **Aterrizaje por rol:** CASHIER → POS, ACCOUNTANT → Contabilidad.
- **Labels de mostrador** (ambos modos): Punto de Venta→Vender ·
  Inventario→Mis Productos · Cobranza→Fiado y Cobros · Finanzas→Mi Plata ·
  Cotizaciones→Proformas · Toma Física→Contar Productos · RRHH→Mi Personal.
- LENDER, ACCOUNTANT y COLLECTOR: sin cambios.

### Fase B — Pantalla de inicio "Mi Negocio"
Home con 4 botones grandes (Vender · Cobrar fiado · Agregar producto · Mi
plata) + el día en 3 números (vendí / me deben / en caja) + checklist de
onboarding integrado.

### Fase C — Simplificar las 3 pantallas críticas
POS modo simple (buscar→cobrar; mayoreo/series/lotes tras "Más opciones") ·
alta de producto en 3 campos (`QuickAddProduct` como camino default) · Fiado
con lista "quién me debe" por antigüedad y botón grande Cobrar.

### Fase D — Ayuda que habla nica
Tours driver.js para fiado y compras · botón fijo "¿Cómo hago…?" · pasada
global de microcopy (voseo, cero jerga, errores en cristiano).

### Fase E — Medir con gente real
Evento mínimo de uso por módulo → decidir qué más esconder · sentar a 2-3
usuarios reales a hacer 3 tareas sin ayuda · iterar.

## Métricas de éxito
- Primera venta en < 2 minutos desde el registro.
- El cajero trabaja sin salir de 1 pantalla.
- % de dueños que nunca necesitan el modo completo (alto = ganamos).

## Reglas de implementación
- Todo **aditivo** y detrás del toggle; cero backend, dinero o `tenantId`.
- Cada fase = PR draft con rondas de QA (método `nortex-feature`).
- El default de cada flag preserva el comportamiento actual, salvo lo aprobado
  explícitamente (pulpería arranca en simple).
