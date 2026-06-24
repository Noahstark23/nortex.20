# Onboarding y Retención de Clientes — Nortex

Plan de **activación y retención**: cómo logramos que un negocio que se registra
aprenda a usar Nortex, llegue rápido a sus “momentos aha” durante la prueba de
**14 días** y se quede. Este documento describe la estrategia, el guion del
**primer día** y cómo está implementado en el producto.

> Complementa el **Manual de Nortex** (`docs/MANUAL_NORTEX.md`): el manual enseña
> cada módulo en detalle; este documento es el **camino guiado** para los primeros días.

---

## 1. El problema

La mayoría de las cuentas que se pierden no se pierden por precio: se pierden porque
el dueño **se registra, no sabe por dónde empezar y abandona** antes de ver el valor.
La meta del onboarding es eliminar esa fricción: que en la primera sesión el negocio
**cargue un producto, haga una venta y vea su panel con datos reales**.

## 2. El embudo de activación

```
Registro → Bienvenida → Primeros pasos (checklist) → Momentos "aha" → Hábito
```

| Etapa | Qué pasa | Señal de éxito |
|---|---|---|
| **Registro** | Crea el negocio (14 días de prueba). | Cuenta creada. |
| **Bienvenida** | Modal que saluda y muestra los primeros pasos. | Ve el checklist. |
| **Primeros pasos** | Checklist que se auto-completa con el uso real. | Completa ≥3 pasos. |
| **Momentos “aha”** | Primer producto, **primera venta**, primer cliente. | Primera venta < día 1. |
| **Hábito** | Usa el POS a diario, invita al equipo. | Retención D7 / D14. |

**Momentos “aha” por tipo de negocio:**

| Negocio | “Aha” principal | Hitos del checklist |
|---|---|---|
| **Ferretería / Pulpería / Retail** | Primera venta en el POS | Datos fiscales · Primer producto · **Primera venta** · Primer cliente · Invitar equipo |
| **Prestamista (LENDER)** | Primer préstamo originado | Datos del negocio · Primer cliente · **Primer préstamo** · Agregar cobrador |

Estos hitos **no se marcan a mano**: el backend (`GET /api/onboarding`) los **deriva de
los datos reales** (conteo de productos, ventas, clientes, empleados, y préstamos por
`lenderId`). Si el negocio ya hizo una venta, el paso aparece completo solo.

## 3. Cómo funciona en el producto

| Pieza | Qué hace | Dónde vive |
|---|---|---|
| **Modal de bienvenida** | Saluda al dueño la 1ª vez tras registrarse. | `components/OnboardingHub.tsx` |
| **Checklist “Primeros pasos”** | Lanzador flotante con barra de progreso y CTAs que llevan a cada pantalla; se auto-completa y se auto-oculta al terminar. | `components/OnboardingHub.tsx` (montado en `Layout.tsx`) |
| **Estado del onboarding** | Deriva los hitos de datos reales; se ramifica por tipo de negocio. | `backend/server.ts` → `GET /api/onboarding` |
| **Tours interactivos** | Coach-marks (driver.js): Inventario resalta elementos reales; POS es un recorrido de 4 pasos. | `utils/tours.ts`, anclas `data-tour` en `Inventory.tsx`, auto-inicio en `POS.tsx` |
| **Centro de Ayuda** | Tutoriales interactivos + guías rápidas por tema + re-mostrar el checklist. | `components/HelpCenter.tsx` → ruta `/app/ayuda` |

**Decisiones de diseño:**
- **Sin migración de BD.** Los hitos se derivan de conteos; las banderas cosméticas
  (bienvenida vista / descartado) viven en `localStorage`, igual que el resto de la app.
- **Solo Dueño/Admin** ven el onboarding (las tareas de configuración son de ese nivel).
- **Saltable siempre** y **persistente hasta completarse** (no solo durante la prueba).
- El checklist enlaza la primera venta/producto **directo al tour** (`?tour=pos|inv`).

## 4. Guion del “Primer día”

### 4.1 Negocio de venta (ferretería, pulpería, retail)
1. **Registrate** y elegí el tipo de negocio. Caés en el panel con la **bienvenida**.
2. Abrí **Primeros pasos** (botón flotante abajo a la derecha).
3. **Configurá tus datos fiscales (DGI)** desde el botón “Configuración DGI” del panel
   (RUC, dirección) — así tus tickets salen válidos.
4. **Agregá tu primer producto** (te lleva a Inventario con un **tutorial**). Cargá nombre,
   precio y stock. Tip: podés importar muchos desde Excel.
5. **Hacé tu primera venta** (te lleva al POS con un **tutorial** de 4 pasos): buscá el
   producto, agregalo, cobrá con Efectivo, imprimí el ticket. 🎉 Tu primer “aha”.
6. **Registrá un cliente** si vas a vender fiado (asignale su límite de crédito).
7. **Invitá a tu equipo** desde Mi Equipo (cada quien marca entrada con su PIN).
8. Volvé al panel: ya verás **Ventas de hoy** y tu **flujo de caja** con datos reales.

### 4.2 Prestamista (LENDER)
1. **Registrate** como Prestamista. El menú cambia a la cartera de préstamos.
2. **Configurá los datos de tu negocio.**
3. **Registrá tu primer cliente** (o se crea solo al originar el préstamo).
4. **Creá tu primer préstamo**: capital, tasa, número de cuotas y frecuencia
   (diaria/semanal/quincenal/mensual). Se genera el plan de cuotas. 🎉 Tu “aha”.
5. **Agregá un cobrador** y asignale préstamos; entra por el celular a su ruta.

## 5. Métricas a seguir

- **Tasa de activación:** % de cuentas que completan ≥3 pasos del checklist.
- **Time-to-first-sale (o first-loan):** horas entre el registro y la primera venta/préstamo.
- **Retención D7 / D14:** % que sigue activo a 7 y 14 días (fin de la prueba).
- **Conversión prueba→pago:** % que activa la suscripción al terminar la prueba.

## 6. Mejoras futuras (no incluidas)

- Persistir las banderas del onboarding por usuario en el backend (multi-dispositivo).
- Correos de activación (“te falta hacer tu primera venta”) con Resend.
- Más tours (Compras, Cobranza, Contabilidad) y anclas `data-tour` en el POS.
- Página in-app del Manual completo enlazada desde el Centro de Ayuda.
- Métricas de onboarding en el Panel Admin.

---

*Documento vivo. Acompaña al Manual de Nortex y al sistema de onboarding (`OnboardingHub`,
`/api/onboarding`, `utils/tours.ts`, Centro de Ayuda).*
