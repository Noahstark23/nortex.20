# Blueprint SaaS para Clientes, Cobranza y Contabilidad

Fecha: 2026-08-22

## Objetivo

Diseñar una segunda capa de producto para Nortex que lleve `Clientes`, `Cobranza` y `Contabilidad` al nivel de un SaaS maduro sin perder el foco de pyme nicaraguense: menos pantallas sueltas, menos friccion operativa, mas contexto por registro, mejor recuperacion de errores y pruebas repetibles antes de cada release.

## Hallazgos en Nortex Hoy

### 1. Clientes existe como directorio, no como hub operativo

Evidencia local:

- [components/Clients.tsx](/Users/stark/Documents/GitHub/nortex.20/components/Clients.tsx:29) renderiza una tabla simple con alta, bloqueo, mayoreo y asignacion de vendedor.
- [backend/server.ts](/Users/stark/Documents/GitHub/nortex.20/backend/server.ts:1875) devuelve `GET /api/customers` con `take: 50`, sin timeline, sin asociaciones, sin actividad reciente, sin tareas de seguimiento.

Impacto:

- El usuario ve un cliente como ficha estatica.
- La cobranza y las ventas viven fuera del registro principal.
- El producto obliga a saltar entre modulos para entender una cuenta.

### 2. Cobranza tiene logica backend util, pero una UX todavia transaccional

Evidencia local:

- [backend/server.ts](/Users/stark/Documents/GitHub/nortex.20/backend/server.ts:9006) ya expone `GET /api/collections/worklist`.
- [backend/server.ts](/Users/stark/Documents/GitHub/nortex.20/backend/server.ts:9085) ya expone `GET /api/customers/:id/statement`.
- [backend/server.ts](/Users/stark/Documents/GitHub/nortex.20/backend/server.ts:9157) ya expone `POST /api/credits/payment`.
- [backend/server.ts](/Users/stark/Documents/GitHub/nortex.20/backend/server.ts:9264) ya expone castigo de incobrables.
- [components/AccountsReceivable.tsx](/Users/stark/Documents/GitHub/nortex.20/components/AccountsReceivable.tsx:54) usa esos rails, pero mezcla detalle, recibos, WhatsApp y castigo con `alert`, `confirm` y `prompt`.

Impacto:

- El motor ya sabe priorizar cartera y calcular estados.
- La interfaz no ofrece una secuencia de cobro madura: siguiente mejor accion, compromiso de pago, historial de gestiones, colas por riesgo.
- Las alertas nativas rompen consistencia y dificultan QA automatizado.

### 3. Contabilidad esta partida en dos superficies

Evidencia local:

- [components/Reports.tsx](/Users/stark/Documents/GitHub/nortex.20/components/Reports.tsx:116) contiene tabs `DASHBOARD`, `CONTADOR`, `CAJAS`, `CONTABILIDAD`, `VENDEDORES`.
- [components/Reports.tsx](/Users/stark/Documents/GitHub/nortex.20/components/Reports.tsx:263) carga balance, estado de resultados y journal.
- [components/Contabilidad.tsx](/Users/stark/Documents/GitHub/nortex.20/components/Contabilidad.tsx:55) vuelve a montar la experiencia contable completa: asiento, diario, balanza, cierre, aging, flujo, periodos, fiscal, retenciones, activos, renta.
- [backend/server.ts](/Users/stark/Documents/GitHub/nortex.20/backend/server.ts:10166) y [backend/server.ts](/Users/stark/Documents/GitHub/nortex.20/backend/server.ts:10269) muestran que el backend si tiene endpoints especializados para aging y flujo.

Impacto:

- El usuario contador tiene dos lugares donde "vive" la contabilidad.
- Es facil duplicar reglas visuales, estados vacios, errores y permisos.
- Cada nueva mejora contable cuesta mas porque la superficie esta fragmentada.

### 4. El patron de alertas nativas esta extendido

Evidencia local:

- [components/Clients.tsx](/Users/stark/Documents/GitHub/nortex.20/components/Clients.tsx:86)
- [components/AccountsReceivable.tsx](/Users/stark/Documents/GitHub/nortex.20/components/AccountsReceivable.tsx:153)
- [components/Contabilidad.tsx](/Users/stark/Documents/GitHub/nortex.20/components/Contabilidad.tsx:239)

Impacto:

- Mala experiencia percibida.
- Estados no auditables visualmente.
- Mayor fragilidad para smoke tests y e2e.

### 5. La cobertura fuerte esta en backend fiscal, no en UX de estos modulos

Evidencia local:

- [tests/fiscalFlow.integration.test.ts](/Users/stark/Documents/GitHub/nortex.20/tests/fiscalFlow.integration.test.ts:1) cubre el rail fiscal real, incluyendo constancia, DMI, declaracion, libros y VET.
- [tests/reportsAvailability.mutation.test.ts](/Users/stark/Documents/GitHub/nortex.20/tests/reportsAvailability.mutation.test.ts:1) cubre funciones puras de reportes.
- La busqueda en `tests/` no devuelve pruebas directas para `Clients`, `AccountsReceivable` ni `Contabilidad`, salvo politica de acceso para cobros en [tests/billingExempt.test.ts](/Users/stark/Documents/GitHub/nortex.20/tests/billingExempt.test.ts:29).

Impacto:

- La logica critica existe y esta bastante defendida.
- La capa operativa visible sigue subprobada.

## Patrones Vigentes en SaaS Exitosos

### Clientes

1. HubSpot organiza la base como objetos, propiedades y asociaciones; el registro no es solo una fila, es el hub donde convergen relaciones y contexto.
   Fuente: https://knowledge.hubspot.com/get-started/manage-your-crm-database

2. HubSpot usa asociaciones y cards para mostrar relaciones y contexto lateral directamente en el record.
   Fuentes:
   - https://knowledge.hubspot.com/records/associate-records
   - https://knowledge.hubspot.com/records/work-with-records

3. HubSpot y Zoho empujan lifecycle stages y handoff visible entre equipos.
   Fuentes:
   - https://knowledge.hubspot.com/records/use-lifecycle-stages
   - https://knowledge.hubspot.com/object-settings/manage-how-lifecycle-stages-sync-between-objects

4. Odoo usa el contacto como repositorio central y aplica reglas comerciales por cliente, incluyendo pricelists.
   Fuentes:
   - https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html
   - https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/prices/pricing.html

### Cobranza

1. QuickBooks y Xero convierten cuentas por cobrar en una cola priorizada por aging, no en una lista plana.
   Fuentes:
   - https://quickbooks.intuit.com/accounting/accounts-receivable/
   - https://www.xero.com/us/guides/accounts-receivable-aging-report/

2. QuickBooks, Zoho y Odoo hacen first-class los estados de cuenta, recordatorios y seguimiento de facturas vencidas.
   Fuentes:
   - https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-statements/create-send-customer-statements-quickbooks-online/L8bvb69Gg_US_en_US
   - https://www.zoho.com/us/books/help/settings/reminders.html
   - https://www.odoo.com/documentation/19.0/applications/finance/accounting/payments/follow_up.html

3. Zoho y Stripe agregan autoservicio: el cliente puede ver facturas, pagar o consultar su historial sin depender del operador.
   Fuentes:
   - https://www.zoho.com/us/books/help/customer-portal/
   - https://docs.stripe.com/customer-management
   - https://docs.stripe.com/customer-management/integrate-customer-portal

4. Zoho integra canales de comunicacion operativos como WhatsApp para estados y cobros.
   Fuente: https://www.zoho.com/us/books/help/integrations/whatsapp/integrate-with-whatsapp.html

### Contabilidad

1. Zoho Books concentra reportes, impuestos y gestion de reportes en un solo modulo con programacion, permisos y comparticion.
   Fuentes:
   - https://www.zoho.com/books/
   - https://www.zoho.com/us/books/help/reports/
   - https://www.zoho.com/us/books/help/reports/manage-reports.html

2. Odoo separa claramente clientes, facturas, cobros, follow-up y contabilidad, pero mantiene navegacion continua entre ellos.
   Fuentes:
   - https://www.odoo.com/documentation/19.0/applications/finance/accounting.html
   - https://www.odoo.com/documentation/19.0/applications/finance/accounting/customer_invoices.html

3. Stripe Billing demuestra un patron util para Nortex: automatizar documentos, cobros y estados, pero entregar autoservicio solo donde reduce friccion real.
   Fuentes:
   - https://docs.stripe.com/billing
   - https://docs.stripe.com/api/invoices

## Que Copiar en Nortex

### Clientes

- Convertir el cliente en hub: perfil, riesgo, deuda, historial de compras, historial de cobro, vendedor asignado, documentos y actividad.
- Agregar estados de ciclo simples y operativos: `prospecto`, `activo`, `en riesgo`, `bloqueado`, `incobrable`, `inactivo`.
- Mostrar asociaciones reales: ventas a credito, ultimos abonos, incidencias fiscales, ruta o vendedor.
- Soportar reglas comerciales por cliente: mayoreo, limite, lista de precios, condiciones de pago.

### Cobranza

- Mantener una worklist priorizada por vencimiento y riesgo.
- Añadir siguiente mejor accion por cuenta: cobrar hoy, enviar recordatorio, promesa de pago, escalar, castigar.
- Registrar gestiones, no solo dinero: llamada, WhatsApp, visita, promesa y resultado.
- Emitir estados de cuenta y mensajes desde una experiencia consistente, no con ventanas nativas.
- Preparar un portal liviano de cliente para consulta de saldo y facturas antes de intentar un portal grande tipo SaaS global.

### Contabilidad

- Consolidar una sola casa contable.
- Separar claramente vistas ejecutivas, fiscal, libros, cartera y tesoreria, pero sin duplicar endpoints ni pantallas.
- Hacer que reportes, cierres y obligaciones vivan en la misma narrativa del periodo.
- Programar descargas y reportes pesados despues; primero unificar navegacion, estados, errores y permisos.

## Que NO Copiar

- No copiar complejidad enterprise de CRM con pipelines infinitos, scoring de marketing o automatizaciones pesadas.
- No copiar customer portal completo tipo Stripe si el problema principal hoy es cobranza operativa por WhatsApp, telefono y mostrador.
- No copiar terminologia contable anglo que complique a pyme local; Nortex necesita lenguaje claro y fiscalmente situado en Nicaragua.
- No copiar profundidad multi-entidad o multi-libro avanzada antes de cerrar consistencia de un solo tenant.

## Target de Producto para Nortex

### 1. Modulo Clientes 2.0

Superficie objetivo:

- Lista con filtros por vendedor, estado, mora, mayoreo, sin actividad y sobrelimite.
- Record view con 4 bloques: perfil, credito/riesgo, actividad comercial, actividad de cobranza.
- Timeline unificada: venta, abono, bloqueo, reasignacion, mensaje, nota, castigo.
- Acciones rapidas: vender, cobrar, enviar estado, bloquear, cambiar condiciones.

### 2. Modulo Cobranza 2.0

Superficie objetivo:

- Inbox de cobranza con colas: `vence hoy`, `1-30`, `31-60`, `61-90`, `90+`, `promesas rotas`.
- Vista lateral del estado de cuenta del cliente sin salir de la cola.
- Drawer de registrar gestion con plantillas por canal.
- Flujo de cobro con recibo, confirmacion y post-accion clara.
- Score simple de riesgo: dias vencidos, saldo, frecuencia de pago, bloqueos previos.

### 3. Modulo Contabilidad 2.0

Superficie objetivo:

- Una sola entrada contable principal.
- Navegacion por periodo, no por pantalla aislada.
- Secciones internas:
  - Resumen del periodo
  - Fiscal y obligaciones
  - Libros y mayor
  - Aging y flujo de efectivo
  - Configuracion fiscal y activos
- `Reports` debe quedar para tablero ejecutivo y analitica, no para duplicar el cockpit contable.

### 4. Sistema de feedback y errores

Objetivo:

- Reemplazar `alert`, `confirm` y `prompt` por componentes consistentes: toast, modal de confirmacion, dialogo con formulario.
- Toda accion sensible debe tener: precondicion visible, mensaje de exito usable, mensaje de fallo accionable y estado intermedio cargando.

## Backlog Recomendado

### Fase 1. Fundacion UX y consistencia

1. Unificar sistema de feedback.
2. Definir layout y rutas canonicas para `clientes`, `cobranza` y `contabilidad`.
3. Eliminar la duplicidad de contabilidad entre `Reports` y `Contabilidad`.
4. Instrumentar eventos de uso por modulo y accion.

### Fase 2. Clientes como hub

1. Expandir `GET /api/customers` con actividad resumida, saldo, aging y ultima interaccion.
2. Crear detalle de cliente con panel lateral o ruta dedicada.
3. Agregar timeline de eventos.
4. Agregar filtros guardables por vendedor y riesgo.

### Fase 3. Cobranza operativa

1. Convertir la worklist actual en inbox con colas persistentes.
2. Registrar gestiones y promesas de pago.
3. Integrar plantillas de WhatsApp desde el estado de cuenta y desde la cola.
4. Añadir autoservicio minimo: enlace seguro para ver saldo y facturas.

### Fase 4. Contabilidad consolidada

1. Mover la experiencia contable completa a una sola superficie.
2. Dejar `Reports` solo con tablero ejecutivo, vendedores y cajas.
3. Normalizar estados vacios, errores y permisos de libros, aging, flujo y cierres.
4. Añadir exportaciones y programacion solo despues de estabilizar navegacion y semantica.

## Estrategia de QA en Loop

### Capa 1. Unit e integracion

- Mantener el rail fiscal actual como guardrail base.
- Agregar tests para:
  - agregados de cliente y timeline
  - worklist de cobranza con prioridades
  - promesas de pago y estados de gestion
  - consolidacion de rutas y permisos contables

### Capa 2. UI/integration

- Tests de componentes para:
  - filtros de clientes
  - drawers y modales de cobranza
  - formularios contables sensibles
  - estados de error y exito

### Capa 3. E2E de negocio

Escenarios minimos por loop:

1. Crear cliente, vender al credito, cobrar parcial, imprimir estado, bloquear por mora.
2. Compra a credito, retencion, libros, DGI y reportes del periodo.
3. Reapertura y cierre de periodo con permisos correctos.
4. Navegacion completa sin `alert` nativas ni pantallas duplicadas.

### Capa 4. Loop de release

Antes de cada despliegue de estos modulos:

1. Smoke local.
2. Suite backend focalizada.
3. E2E de negocio.
4. Exploratorio manual sobre UX de errores, vacios y permisos.
5. Staging con dataset descartable.
6. Segundo loop de regresion sobre los 3 escenarios mas rentables: venta a credito, cobro, cierre fiscal.

## Orden de Implementacion Recomendado

1. Sistema de feedback unificado.
2. Consolidacion de contabilidad.
3. Hub de cliente.
4. Inbox de cobranza.
5. Portal ligero de cliente.

## Criterios de Exito

- Un operador puede entender una cuenta sin saltar entre tres pantallas.
- Un cobrador puede ejecutar su siguiente accion sin prompts nativos.
- Un contador no tiene dos modulos compitiendo por el mismo trabajo.
- Cada release de estos modulos pasa el loop completo de pruebas antes de promoverse.

## Nota de alcance

Este blueprint recomienda una direccion basada en:

- el estado actual del repo en `components/` y `backend/server.ts`
- la cobertura observada en `tests/`
- patrones vigentes consultados el 2026-08-22 en documentacion oficial de HubSpot, QuickBooks, Xero, Zoho Books, Stripe y Odoo

No es una aprobacion de despliegue. Primero hay que ejecutar la Fase 1 y dejar passing el loop de QA para estos tres modulos.
