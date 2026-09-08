# Primera venta, regreso y modularidad de Nortex

Fecha: 2026-09-04. Estado: primera entrega local verificada. No desplegada.

## Decisión y evidencia

El fundador informa que muchas personas registradas nunca venden o hacen una sola venta y no vuelven. También informa 45 personas registradas, 3 usuarios habituales y uso en ferreterías y farmacias. Son señales para investigar el recorrido; no constituyen una cohorte de retención ni identifican por sí solas la causa del abandono.

La inspección del código y una prueba de navegador con datos sintéticos identificaron bloqueos concretos. Esta entrega los corrige sin cambiar la autoridad transaccional de la venta. No demuestra todavía una mejora comercial: esa conclusión exige observar negocios reales y medir repetición de uso.

| Hallazgo | Evidencia del estado anterior | Cambio local |
|---|---|---|
| El cobro móvil desaparece | En modo simple, `showCashPreModal` cerraba `PosTicketShell`, aunque el formulario de efectivo estaba dentro del mismo panel. Reproducido a 390×844: Cobrar ocultaba recibido/vuelto | El panel permanece abierto en el cobro guiado; otros pagos y modo avanzado conservan sus superficies |
| Existencia implícita | El alta rápida proponía stock `1` dentro de Más datos opcionales. Vender esa unidad agota ese producto si se acepta el valor | Existencia visible y vacía al abrir; validación explícita de blanco, cero y cantidad entera |
| Sin continuación tras primera venta | Inicio quitaba la guía al detectar cualquier venta; postventa priorizaba Volver al inicio | Inicio distingue cero, una y varias ventas; postventa prioriza Hacer otra venta y prepara un ticket vacío |
| Texto difícil de leer | Títulos oscuros y etiquetas claras de tarjetas se mezclaban con los fondos del POS | Títulos/copy con tokens de canvas y tinta legible sobre tarjetas claras |
| Progreso/cifras desactualizados | La consulta de Inicio no reaccionaba a cambios; la caché podía conservar el estado anterior al volver del POS | Lectura actual al entrar, actualización por evento y descarte de respuestas anteriores/de otra sesión; fallo de un endpoint deja solo sus cifras sin dato |
| Monolitos concentran cambios | Catálogo, presentación y estados locales dentro de POS; GET de onboarding completo dentro de server | Catálogo extraído a un componente; GET de activación separado en router y servicio inyectable |

La ruta de registro/autenticación no se rediseñó. Su conversión y la importación masiva quedan en el siguiente bloque de observación. Tampoco se cambian reglas de precio, cálculo fiscal, idempotencia, asientos, turno ni mutación de existencias del backend.

## Comportamiento entregado

### Inicio

- Cero ventas confirmadas: Registrar primera venta; explica nombre, precio y existencia real si falta catálogo.
- Una venta confirmada: Registrar otra venta, utilizando los productos guardados y recordando revisar existencias reales cuando se agoten.
- Varias ventas: Vender antes de los indicadores del día.
- Práctica y ayuda son acciones secundarias. Se conserva acceso a fiado, productos y Mi plata.
- Error de progreso: explicación y Reintentar sin bloquear el acceso al POS. Error de cifras: no presentar como actuales los valores anteriores.
- El endpoint anterior, sin `salesProgress`, sigue siendo compatible. Un checklist con venta hecha no se interpreta como exactamente una venta.

### Alta rápida y cobro

- Nombre, precio y existencia siempre visibles. Código y costo permanecen opcionales.
- Existencia vacía muestra un error; cero explícito es válido para guardar el producto.
- Con cero y política de inventario negativa deshabilitada o desconocida, guarda el producto sin agregarlo al ticket y lo explica. Si la política permite negativos, conserva el comportamiento autorizado existente. No se inventa stock.
- El cobro móvil conserva visible el ticket, el recibido y el vuelto antes de confirmar.
- Al completar la primera venta, Hacer otra venta limpia el ticket y devuelve al catálogo; Volver al inicio queda disponible.

### Contrato de activación y aislamiento

`GET /api/onboarding` conserva URL y autenticación. El tenant se obtiene del JWT, no de parámetros del navegador. El servicio usa el cliente Prisma compartido y no escribe datos.

Para comercios añade opcionalmente:

```ts
salesProgress?: {
  confirmedSales: number;
  lastSaleAt: string | null;
}
```

Conteo y última venta excluyen `VOIDED` (anulación canónica) y `CANCELLED`. Crédito pendiente válido cuenta como venta. El tipo LENDER conserva sus pasos y omite el progreso de ventas. La siembra de catálogo no se movió ni se modificó.

El frontend descarta respuestas si cambian token/tenant, si llega una actualización posterior o si se desmonta la pantalla. Los importes siguen viniendo de los endpoints existentes; este componente no sustituye su autorización.

## Reducción de concentración

| Archivo / indicador | Antes de esta entrega | Después |
|---|---:|---:|
| `backend/server.ts`, líneas | 15.451 | 15.347 |
| `components/POS.tsx`, líneas | 7.579 | 7.245 |
| Referencias textuales `useState` en POS, incluida importación | 123 | 121 |

`MiNegocio.tsx` también baja de 321 a 242 líneas. Los destinos nuevos contienen 30 líneas de router, 101 de servicio, 410 de catálogo, 94 de presentación de Inicio y 110 del hook. El tipo de onboarding y el validador suman 9 líneas; CajaNicaCatalog mantiene 285. El conjunto de código de producto afectado aumenta **237 líneas netas**, sin contar tests/documentos.

Son 438 líneas menos en los dos archivos centrales. No es una reducción equivalente del código total: las responsabilidades pasan a módulos y se añaden contratos/pruebas. El POS y el servidor siguen siendo grandes; esta entrega inicia su separación, no la termina.

Fronteras nuevas:

- `HomeSalesJourney`: presentación de la acción principal.
- `useActivationJourney`: sesión, estado y refresco del recorrido.
- `PosCatalogPane`: categorías, paginación y presentación del catálogo. Búsqueda/escáner y acciones de venta mantienen sus contratos.
- `onboardingStatusService`: lectura del estado de activación; router pequeño para transporte y errores.

El presupuesto del POS baja al tamaño real y no se amplía para hacer pasar pruebas. AGENTS/CLAUDE coordinan un responsable por área, archivos acordados, contratos antes de paralelizar y revisión integrada al terminar.

## Pruebas y límites

Verificación sobre la copia aislada con Node 22.23.2 y las dependencias locales existentes:

- Prisma generate y validate: pasan, sin cambiar schema ni migraciones.
- TypeScript completo: pasa.
- Vitest: **3.480 pruebas pasan, 64 omitidas; 271 archivos pasan y 11 se omiten**. El ensayo anterior tenía 3.416 pruebas aprobadas; el aumento neto es 64, además de reemplazar comprobaciones de texto por recorridos renderizados.
- Verificación de sistema de diseño y build de producción: pasan.
- Cobertura específica: autenticación/roles/tenant en onboarding, cero/una/varias ventas, backend anterior, caché al volver, fallos de red/cifras, respuestas tardías, categorías/paginación/foco, existencia vacía/cero/positiva, política de negativos, cobro móvil y nueva venta.

El build conserva avisos de tamaño: chunk POS 534,48 kB e inicio 668,32 kB minificados. La extracción mejora la separación de responsabilidades; **no redujo el bundle**. La optimización de carga queda pendiente. Tras el último ajuste de tipos del fixture de prueba, TypeScript y el flujo POS (6/6) volvieron a pasar.

La suite excluyó `tests/serverStartup.test.ts` para no iniciar servicios desde el checkout de auditoría. Las 64 omisiones incluyen integración que necesita servicios/DB; no se presenta como integración MySQL superada. No se ejecutaron migraciones, carga, mutación, instalación limpia de dependencias, auditoría de dependencias, staging ni validación de producción. El cambio no modifica lógica de cálculo de dinero; la venta real necesita su compuerta de release y humo autenticado antes de publicarse.

Navegador local con API interceptada y fixtures propios: sin usuarios reales, sin base de datos de producción y sin enviar mensajes. Se usaron el App y los componentes reales de la copia aislada; los saldos, turnos, productos y respuestas HTTP son sintéticos. La prueba visual no verifica persistencia MySQL ni conciliación de caja/stock. No se imprimieron tickets ni se probó hardware.

Recorridos visuales comprobados: Inicio con cero/una venta; alta con existencia vacía y corrección; producto al ticket; cobro móvil con recibido/vuelto; confirmación; nueva venta vacía; catálogo móvil y escritorio. Evidencia exportada junto a este documento. No se afirma certificación de accesibilidad completa ni prueba con usuarios finales.

## Siguiente bloque de trabajo

1. **Validar con personas.** Observar a los tres habituales y a cinco registrados sin uso, separando ferretería/farmacia. Medir dónde paran, qué esperan y cuándo requieren ayuda. No enviar contactos automáticos como parte de esta entrega.
2. **Medir primera y segunda venta.** Por tenant real y cohorte madura: primer intento, error clasificado, primera venta confirmada, siguiente sesión con venta y días de uso. Separar una segunda venta inmediata de volver otro día; excluir demo/pruebas/anuladas. Los clicks de analítica no sustituyen hechos confirmados del backend.
3. **Completar carga inicial.** Validar importación de catálogo, unidades/empaques para ferretería y lotes/vencimientos para farmacia. Priorizar según los bloqueos observados, con datos sintéticos para QA y reglas propias por vertical.
4. **Continuar separación con pruebas.** Siguiente pieza propuesta: alta rápida como componente con su propio borrador; luego postventa/impresión, carrito/cotización/aparcado y consultas del POS. Extraer checkout/transacciones solo con pruebas de dinero, stock, roles, replay y MySQL. Cada pieza termina con revisión antes de abrir otra del mismo dominio.
5. **RAG y WhatsApp como soporte del recorrido.** Mantener el plan de ayuda documental, identidad y colas durables. El canal nuevo se valida por tareas resueltas y regreso a vender; no reemplaza la reparación del cobro actual.

Criterio para considerar útil esta intervención: personas reales completan la venta sin asistencia de ingeniería y vuelven a operar en una sesión posterior. Los umbrales comerciales y el calendario siguen en el [plan general](PLAN_TRANSFORMACION_TOTAL_2026.md). Esta entrega no cierra T03, T04 completo, T14 completo ni los pendientes de seguridad/escala de la auditoría general.
