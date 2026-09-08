# Nortex: reparación de prioridades y verificación por módulo

> Evidencia histórica del snapshot local basado en d326c589. El candidato integrado sobre main2834497 requiere resultados nuevos. Main ya aporta ProductBatchHold, heldStock y disponibilidad farmacéutica autoritativa: su ausencia en el snapshot no describe producción.
Fecha: 2026-09-04. Estado: **VALIDADO_LOCAL en los escenarios descritos; módulos y pilotos pendientes explícitos**. Responsable de producto: fundador. Implementación: un editor por área; revisión independiente y QA del candidato aislado. Este documento sustituye el estado anterior de E01–E08, conserva sus límites y registra los hallazgos de la revisión posterior de módulos.

## Resultado del paquete E01–E08

| Prioridad | Cambio implementado y evidencia | Límite que permanece |
|---|---|---|
| E01: pagos y contabilidad | Política común: efectivo en Caja 1.1.1; tarjeta, transferencia y QR confirmados en Bancos 1.1.2; crédito en CxC. Venta, abono y devolución usan la misma selección. Regresión previa: 12 fallos; después 14 casos aprobados. Circuito HTTP/MySQL venta → devolución aprobada → reembolso pendiente → liquidación, por canal. Mutación dirigida de los seis generadores contables y selector: 200/200 detectados. | No se conciliaron movimientos históricos ni se modificaron datos productivos. Un pago electrónico manual confirmado no equivale a un pago pendiente de una pasarela. |
| E02: vencimientos | FEFO, Avisos e Inventario comparten fecha civil de Managua, independiente de la hora con que se guardó el lote. Casos ayer/hoy/mañana, medianoche UTC, varias bodegas, OFF/SHADOW/ENFORCED y fecha del replay. Pruebas ejecutadas también con TZ Pacific/Auckland. | Falta un modelo completo de inventario físico/vendible/retenido y su UI. La cuarentena de devoluciones no sustituye ese modelo. No certifica una farmacia completa. |
| E03: recuperación | Avisos lista cada venta guardada, referencia, fecha de Managua, importe, motivo y evidencia mínima descargable. Consulta de solo lectura por tenant y autor. Reintento conserva ID y payload; estados inciertos siguen retenidos. Pruebas de respuesta perdida, sesión cambiada, permisos y aislamiento. Navegador real: venta ficticia sin conexión → pendiente → reconexión → confirmación por la misma referencia. | Falta prueba física de cierre abrupto, almacenamiento del dispositivo, varios navegadores y acompañamiento del comercio en un incidente real. Consultar una referencia no marca una venta como sincronizada. |
| E04: transacciones y CI | Resolución/siembra de cuentas dentro del mismo cliente transaccional. Prueba MySQL con pool de una conexión. CI incorpora integración obligatoria y exige ejecución real de todas sus suites, DB disponible y backend propio saludable; el despliegue a staging depende de este job. Pruebas negativas de DB ausente, suite omitida y resumen verde viejo. | El workflow local no prueba que GitHub lo haya ejecutado ni que estén configuradas sus protecciones remotas. Pruebas de concurrencia no equivalen a una jornada de un comerciante con hardware. |
| E05: activación | Primera/última venta válida, conteo y fechas salen de ventas persistidas; excluyen VOIDED/CANCELLED/DRAFT. Retorno en otro día civil de Managua separado de repetir venta en la misma sesión. El evento de URL se llama `first_sale_flow_completed`, sin atribuirle una primera venta real. | Falta instrumentar y observar cohortes comerciales maduras y pagos. 45 registrados y 3 habituales siguen siendo autorreporte, no una tasa D7/D30. |
| E06: uso cotidiano | Ticket de cinco líneas visible a 1280×720, controles operativos de 44 px, importe largo visible a 320 px y ticket de 20 líneas desplazable con cobro accesible. Modo reactivo compartido; conserva carrito, cliente y diálogo de efectivo, incluido USD. Corrección “Queda 1 unidad”. | No se completó una auditoría WCAG ni pruebas con lector de pantalla, zoom 200 %, impresoras o escáneres físicos. |
| E07: catálogo | Índice reutiliza normalización sin conservar objetos de precio/stock viejos. Tras venta online consulta solo IDs vendidos, hasta 100 por petición, con filtro de tenant/rol. Fusión autoritativa, eliminación de IDs pedidos ausentes y fallback completo. Pruebas de respuestas tardías, sesión, servidor viejo y errores. | Carga inicial completa; refresco parcial no informa cambios externos de otros productos en tiempo real. No hay caché persistente nueva. Benchmark CPU no mide SQL, red, DOM ni equipo económico. |
| E08: modularidad | Extraídos editor numérico, índice, carga de catálogo y preferencia de modo; se compone recuperación offline existente. POS: 7050 → 6949 líneas; referencias `useState`: 118 → 114. Presupuesto descendente. AGENTS, CLAUDE y skill nortex-feature reconciliados con aislamiento y pruebas reales. | El conjunto frontend intervenido crece 172 líneas por las nuevas capacidades. No se declara reducción global ni refactor completo del monolito. |

## Fallos adicionales reparados durante la revisión de módulos

Medición del paquete completo: 35 archivos de ejecución intervenidos, 32.915 → 33.575 líneas (**+660**), incluyendo backend, recuperación y UI; excluye tests, docs y scripts. Extraer 101 líneas del POS mejora su frontera, pero esta entrega agrega capacidad y controles: no reduce el tamaño total del producto. El +172 citado en E08 es solo el subconjunto frontend de esa extracción.

1. **Reposición doble de una devolución en cuarentena.** Reproducción MySQL: dos respuestas 200, stock final 7 en vez de 5 y dos efectos contables/auditorías. Ahora se reclama `tenant + id + PENDING` mediante actualización condicional dentro de la transacción, antes de modificar stock/dinero. Resultado comprobado: 200/409, stock 5 y un solo efecto. Un fallo posterior revierte también el reclamo.
2. **Datos sensibles de clientes.** EMPLOYEE podía leer cartera/hub/estado de cuenta. Cinco endpoints aplican la política de lectura sensible; el catálogo básico de clientes conserva su uso operativo. La prueba HTTP que esperaba 403 y obtenía 200 ahora pasa.
3. **Nómina y asistencia.** Lecturas de aguinaldo, finiquito y panel RRHH ahora tienen autorización por rol. La ruta genérica de nómina interceptaba `aguinaldo/:year` y producía 500: ruta específica primero y validación de mes/año. Acceso al recibo propio se conserva. Clock-in/out requieren un PIN válido antes de consultar; `{}` ya no elimina el filtro y selecciona otra persona.
4. **Privacidad de WhatsApp.** Se retiró la herramienta de ventas internas del canal de clientes, incluso de su resolución directa; catálogo siempre publicado. Identidad usa teléfono completo normalizado, solo equivalencia local nicaragüense, tenant, coincidencia única y revalidación por mensaje. 22 casos MySQL incluyen duplicados y caracteres inesperados; detectaron y corrigieron un borde de expresión regular que los mocks no mostraban. No se habilitó transporte ni se enviaron mensajes.
5. **Falso estado del reporte de QA.** Un rechazo temprano podía conservar un resumen verde anterior aunque el proceso fallara. El runner invalida el resumen antes de validar configuración y registra el intento fallido. Regresión real con directorio temporal: URL inválida y autorización de DB ausente.

## Matriz de módulos

**Lectura de la tabla:** HTTP/MySQL significa operaciones contra la base descartable de QA. UI significa recorrido del navegador con el negocio ficticio; no implica cada botón/CRUD. Unitario/componente utiliza pruebas aisladas o transporte simulado. Revisión de código identifica un riesgo, sin llamarlo incidente productivo. No se suman los conteos de suites solapadas.

Se visitaron las 32 rutas internas distintas de POS del panel ADMIN; POS se probó aparte. No hubo errores de consola en ese recorrido online. La desconexión deliberada se probó después y genera fallos de red esperados. Las rutas de otros roles/canales aparecen aparte con su cobertura real.

| Módulo / rutas | Evidencia ejecutada | Resultado y trabajo restante |
|---|---|---|
| Mi Negocio / inicio | UI, onboardingStatusService, miNegocioActivation y primera venta real de QA | Carga y datos de activación comprobados. Falta observación de usuarios y cohortes. |
| POS / pos | UI escritorio/móvil, efectivo real, cola offline y reconexión; posVentaCritica/activationFlow; posIntegrity HTTP/MySQL | Casos de venta, precio, stock, reintento y roles cubiertos. Hardware y jornada física pendientes. |
| Avisos | UI sin pendientes y detalle de venta offline; operationalAlerts, notifications y recuperación | Estados honestos y referencia visible; vencimientos unificados. No es un centro general de mensajes de todos los módulos. |
| Ventas y devoluciones / sales | UI; posIntegrity, returnIdempotency, saleCorrections, returnService, cuarentena concurrente MySQL | Circuito de canales y devolución aprobada probado. Pendiente competir RESTOCK/DISCARD con varios lotes y comprobantes físicos. |
| Caja / cash-registers | UI; cashCloseJournal MySQL (50 postings, 20 reversos y cierres concurrentes), closeShiftIdempotency | Idempotencia y cierre cubiertos en fixtures. Falta jornada completa y gaveta física conciliada. |
| Inventario / inventory | UI; inventoryAdjust HTTP; batchExpiry, manualBatch y movimientos por bodega | Ajustes, fechas y límites comprobados. UI de cada merma no recorrida con todos los perfiles. |
| Bodegas / warehouses | UI; stockCountWarehouse, procurementPhaseTwoB, ledger y transferencias | Aislamiento por bodega y modos cubiertos. Falta una carrera conjunta transferencia/venta/conteo de la misma unidad. |
| Conteo / inventory-count | UI; stockCountWarehouse HTTP y guardas de preflight/lotes | Casos de conteo concurrente probados; dispositivos y recorridos completos del bodeguero pendientes. |
| Lotes y farmacia | FEFO/fechas, recepción, ajustes y devoluciones; HTTP/MySQL de movimientos manuales | Modo y fecha coherentes en alcance probado. Inventario retenido general y habilitación de farmacia siguen pendientes. |
| Órdenes de compra / purchase-orders | UI; procurementPhaseOne/Two/TwoB HTTP | Recepción, factura, IVA, PPV, locks y replay cubiertos. CLOSED_SHORT/aceptar-rechazar requieren más recorrido HTTP. |
| Compras / purchases | UI; purchaseFlow y procurement HTTP | Compra directa, pagos/caja y cuentas por pagar en fixtures. No acredita todos los documentos fiscales reales. |
| Compras inteligentes / smart-purchases | UI y lectura de código | Pantalla de recomendaciones carga; precisión de predicción y retorno comercial no validados. |
| Proveedores / suppliers | UI; supplier 360/pagos dentro de purchaseFlow/procurement; supplierPayment/Returns | Pagos por transferencia reales de QA. Devolución a proveedor y nota de crédito tienen principalmente pruebas aisladas. |
| Clientes / clients | UI; customerFlow HTTP, política de cartera y hub | Bloqueo EMPLOYEE corregido. No se recorrió todo CRUD con cada uno de los roles. |
| Fiado y cuentas por cobrar / receivables | UI; customerFlow, pagos, autorización y asientos | Casos de deuda/abono y aislamiento cubiertos. Operación de cobranza diaria completa pendiente. |
| Proformas / quotations | UI; publicQuotationSaleChain, quotation/cartPersistence y transporte de venta | Cadena/snapshot/caducidad aislados; no todos los estados HTTP de proforma. |
| Reportes / reports | UI; fiscalFlow HTTP, fiscalRegime, ivaPeriodo y salesQuantityReport | Contratos de IVA/unidades y casos fiscales cubiertos. Faltan todos los filtros, exportaciones y conciliación por reversos. |
| Contabilidad / accounting | UI; generadores reales, 200 mutantes dirigidos, journalSingleConnection/cashCloseJournal MySQL | Canales, atomicidad y pool reparados. Catálogo/cierres y cumplimiento profesional requieren revisión contable propia. |
| Auditoría / audit | UI; efectos únicos y rollback en pruebas MySQL | Consulta carga y eventos de operaciones críticas comprobados. No demuestra integridad de todo evento del monolito. |
| Dashboard / dashboard | UI y contratos de navegación/activación | Carga del negocio real de QA. KPI bajo todas las devoluciones, anulaciones y cambios de día pendientes. |
| Salud financiera / financial-health | UI, revisión de código/política contable | Falta suite específica de score, KPI y línea de crédito. No usar la presencia del panel como validación de elegibilidad financiera. |
| Facturación de Nortex / billing | UI; billingCobro/billingExempt | Renovación, montos y exenciones aislados. No se ejecutó banco, Stripe ni aprobación real de pago. |
| Equipo / team | UI; teamVisualSemantics, authRevalidation; invitaciones como fixtures HTTP | Revocación/degradación de rol cubierta. Falta flujo dedicado invitar/aceptar/caducar y último administrador concurrente. |
| RRHH / hr | UI; nicaLabor/calc-laborales; hrAccess HTTP y hrClockPin | Roles/PIN/aguinaldo corregidos. Persisten carreras de decisiones de ausencia/adelanto descritas abajo; planilla completa no certificada. |
| Mi Espacio / mi-espacio | UI; miEspacio componente y recibo propio HTTP | Ficha, ausencia/adelanto y recibo aislados. Falta aislamiento HTTP de todos los `/api/me/*`. |
| Reparto / delivery | UI; deliveryManager/Kanban; delivery.mysql HTTP/MySQL y rutas | Despacho, entrega y liquidación del escenario de integración. GPS/dispositivo y jornada de conductor pendientes. |
| Conductor, seguimiento y registro / driver, track, repartidor | driverRoute/View y contratos de autorización; lectura de rutas | No hubo nuevo recorrido de navegador por estos perfiles/canales. No confundir la UI ADMIN de Reparto con la del conductor. |
| Mi Carga / mi-carga | UI ADMIN con estado “sin bodega asignada”; políticas de catálogo y productRefresh HTTP | Filtro de catálogo vendedor probado. No es una jornada de venta ambulante con usuario asignado. |
| Prestamistas / cartera, cobros, cobradores | Tres rutas UI y pruebas aisladas de motores/deuda/permisos | En el tenant comercio son alias del Dashboard. No se ejecutó una cartera de prestamista ni desembolsos reales. |
| Agente bancario | Lectura de `routes/agentBanking.ts`; no se encontró suite que importe su router/helpers reales | Guards tenant/rol y débitos atómicos existentes no equivalen a jornada validada. Hallazgos M07 de caja/cierre y límites de auditoría/reporte; sin prueba MySQL del módulo ni conciliación con un partner. |
| Seriales / serials | UI y revisión backend | Fase 1 manual; no acredita venta→serie→devolución. Riesgos de integridad descritos abajo. |
| Balanzas / scales | UI; scaleAdapters, scaleLabelAcceptance, etiquetas y replay | Adaptador/parser cubiertos. Falta balanza física, calibración y matriz de equipos. |
| Marketplace / marketplace | UI “Próximamente”, revisión endpoint | No es una capacidad comercial terminada. Backend de pedido aún necesita cierre de capacidad/precio/idempotencia. |
| Blueprint / blueprint | UI y lectura | Visor de arquitectura interno; no cuenta como función comercial entregada. |
| Ayuda / ayuda | UI y helpCenter | Destinos y acciones accesibles probados. Comprensión de comerciantes nuevos todavía por observar. |
| Público, acceso y catálogo / landing, register, login, demo, pedidos, blog | Registro/login sintético y pruebas publicExperience/publicActivation/GuestPOS/catálogo | No se recorrieron todas las páginas, reset de contraseña, SEO en producción ni todos los pedidos públicos. |
| Superadmin / admin | Revisión de requireSuperAdmin y authRevalidation | No se elevó el rol del comercio de QA. Falta probar aprobación/suspensión/desembolso concurrente y auditoría de cada comando. |
| RAG / WhatsApp | Privacidad de herramientas e identidad; 22 casos SQL reales, pruebas aisladas y código | Buscador híbrido de catálogo, sin RAG documental completo. Transporte no habilitado; disponibilidad vendible y cola durable pendientes. |

## Hallazgos nuevos: siguiente paquete, no ocultarlos como “verificados”

La petición ordenó reparar E01–E08 y después revisar módulos. Esta segunda revisión encontró lo siguiente; son entregas adicionales con condiciones concretas. No están resueltas por las mejoras del POS.

| ID / prioridad | Evidencia y riesgo | Implementación / prueba de salida |
|---|---|---|
| M01 / P1 RRHH | Código de `routes/hr.ts`: aprobación de ausencia/adelanto valida PENDING y luego actualiza sin reclamarlo; alta de adelanto separa comprobación y creación. No se reprodujo la carrera en DB. | Servicio transaccional con bloqueo o claim tenant/id/PENDING y auditoría; dos decisiones simultáneas → un efecto, vacaciones sin doble descuento. No cambiar fórmulas laborales en ese arreglo. |
| M02 / P1 Marketplace | POST `/api/b2b/order` permanece activo aunque UI sea “Próximamente”; toma total/items del cliente y no tiene clave idempotente. La lectura demuestra el contrato, no un abuso productivo. | Cerrar capacidad backend hasta catálogo real; luego precio/item autoritativo, payload hash y replay. Repetir pedido no crea otro débito. |
| M03 / P1 Seriales | `routes/serials.ts` permite SOLD sin vínculo obligatorio a venta/producto; modificación y auditoría separadas; vuelta a stock elimina vínculo. | Máquina de estados, relación con producto vendido, historial inmutable y transición/auditoría atómicas. Prueba registrar → venta → devolución más fallo de auditoría. |
| M04 / P1 disponibilidad WhatsApp | RAG devuelve Product.stock físico; no siempre equivale a vendible por bodega/lote. | Consumir disponibilidad autoritativa; físico positivo/vendible cero debe responder no disponible. No prometer reserva ni replicar FEFO en el agente. |
| M05 / P1 entrega WhatsApp | Webhook confirma antes de cola en memoria; salida enviada antes de persistir resultado. Reinicio/respuesta incierta requieren contrato durable. | Inbox persistido antes del 200 y outbox con intención/envío/evidencia; reintento incierto requiere conciliación. Pruebas de reinicio y respuesta perdida, sin mensajes reales durante QA. |
| M06 / P2 cobertura de administración | Equipo, Dashboard/Finanzas, Superadmin y seriales carecen de demostración integral; la navegación no prueba su lógica. | Suites de casos reales por rol/tenant, negativos y carreras del comando; UI de los roles respectivos. |
| M07 / P1 agente bancario | `agentBanking.ts`: `calcularGaveta` suma CASH sin excluir VOIDED/cancelledAt; `assertGavetaAlcanza` bloquea Shift solo para OUT y no relee estado. OPEN se validó antes de la transacción: cierre podría ganar y la operación/reversa continuar. Evidencia de código, sin carrera DB reproducida. | Releer OPEN bajo el lock compartido con cierre para todos los movimientos de caja; calcular efectivo con el mismo contrato de anulación. Pruebas MySQL: cierre gana → operación rechazada sin efectos; venta anulada no financia un retiro. Revisar también snapshots de auditoría fuera de tx y reporte que suma importes sin normalizar moneda. |

## Benchmark de catálogo

Mismo dataset sintético y Node 22.23.2, 5 calentamientos y 40 muestras. Medianas en milisegundos, antes → después:

| Productos | Construcción inicial | Refrescar índice con nuevo stock | Buscar SKU final | Búsqueda parcial |
|---|---:|---:|---:|---:|
| 1.000 | 0,324 → 0,384 | 0,321 → 0,046 | 0,060 → 0,006 | 0,116 → 0,053 |
| 10.000 | 3,397 → 3,971 | 3,401 → 0,656 | 0,586 → 0,057 | 0,769 → 0,206 |
| 50.000 | 20,024 → 22,893 | 19,456 → 5,737 | 3,064 → 0,147 | 4,033 → 1,069 |

La indexación inicial cuesta más; búsquedas/refrescos mejoran. Medición CPU aislada: no garantiza capacidad comercial con 50.000 productos ni latencia en teléfonos. La carga completa inicial y la frescura de cambios de otras cajas son el siguiente trabajo de rendimiento, previa medición real.

## Cómo reproducir la validación

Node 22.23.2, lockfile del candidato y MySQL 8. Las pruebas usan un entorno explícito sin proveedores externos. Nunca ejecutar `db push` contra producción para reproducir QA. Preparar una base nueva y descartable cuyo nombre sea `nortex_qa`, `nortex_quality`, `nortex_test` o un sufijo permitido, con URL de loopback; generar Prisma y aplicar el schema solo allí. Luego ejecutar:

```sh
npm test -- --run
npx tsc --noEmit
npx prisma validate --schema backend/prisma/schema.prisma
npm run build
npm run test:integration:required
npm run test:mutation
```

La integración requiere `DATABASE_URL` de esa base y `NORTEX_QA_DATABASE_ACK=disposable-database`. El runner crea su backend y claves de QA; no necesita `.env`, WhatsApp, Stripe ni base del usuario. El job CI documenta la preparación reproducible. `npm test` omite intencionadamente pruebas que requieren servidor; esas omisiones solo se cierran con la compuerta obligatoria. El informe final cuenta por separado repeticiones de pruebas en archivos mixtos.

Los archivos `AGENTS.md`, `CLAUDE.md`, `.claude/skills/nortex-feature/SKILL.md`, plan de dirección, plan maestro e índice documental apuntan a esta evidencia. Un texto que prohíbe errores no sustituye su prueba negativa ejecutable.

## Validación final y entrega

- **Suite general:** 3.833 casos aprobados; 115 requieren servidor y quedan omitidos en ese comando.
- **Compuerta obligatoria:** 17 suites, 129 casos aprobados, cero omitidos. Incluye las 115 omisiones anteriores y 14 casos unitarios repetidos del archivo mixto de movimientos manuales. Resultado consolidado: **3.948 casos aprobados sin contar repeticiones entre comandos**. Se cruzaron archivo/nombre y multiplicidad de casos parametrizados entre reportes; cero omisiones sin evidencia.
- **TypeScript, Prisma validate, sistema de diseño y build:** aprobados. Sin migración del schema en este paquete.
- **Mutación global:** 99.88 %, umbral intacto 99,85 %, 46 archivos; 5088 detectados por aserciones, 4 por timeout, 6 supervivientes y 20 ignores preexistentes. Se aprobó también la guardia de alcance/pisos. El score no es cobertura de todo el SaaS. Los seis supervivientes equivalentes están en nicaLabor, money, pricing y stockAlert; no se añadieron exclusiones para ocultarlos.
- **Regresión de calidad:** la primera mutación global dio 99,53 % y falló. Se reforzaron contratos de invalidación/reutilización del buscador, huella de aprobación de devolución y configuración Decimal. La segunda pasada supera el umbral sin reducirlo. Mutación dirigida: contabilidad 200/200, buscador 103/103 y huella de devolución 32/32 detectados.
- **Navegador:** primera venta CASH sintética y cobro, tickets 1/5/20, 1280×720 y 320×740, total C$ 99.999.999,90 sin recorte. Venta offline con referencia c8c9a2d1-c5ad-4880-8bfb-17e361fe2098 confirmada al reconectar y consultada por HTTP. Recorrido de 32 rutas internas del panel además del POS; las operaciones de otros roles/canales se distinguen en la matriz.
- **Límites:** no se ejecutaron dispositivos físicos, observación de usuarios, conciliación histórica, GitHub remoto ni producción. M01–M07 permanecen abiertos; una prueba local del POS no aprueba esos módulos. La demo usa datos ficticios en 127.0.0.1:4200, conservando la vista anterior del usuario.

Candidato aislado a partir del checkout con cambios sobre `d326c589a756db7977d14c94a625b6c895cb3313`. Antes de reintegrar se comprueba hash de cada archivo de origen, HEAD e índice; se guardan parche, copia anterior y manifiesto. La telemetría desactivada solo para la copia de QA no forma parte del parche de producto. No se despliega ni se altera la DB productiva.

La siguiente decisión de producto exige observar cinco registrados de poco uso y a los tres habituales por separado, completar las tareas de tienda y medir retorno por día. Esos resultados, no un nuevo rediseño o más agentes, determinarán si la mejora consigue uso recurrente.
