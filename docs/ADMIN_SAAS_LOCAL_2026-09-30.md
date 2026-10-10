# Administración SaaS — evidencia local del 30/09/2026

Estado del corte v1: QA local ejecutada, revisión independiente BLOCK. Responsable de producto: Noel. Este lote entrega lectura administrativa; no amplía agentes ni confirma operaciones del dominio.

La revisión de v1 (`65a1b49138bffca0bd6769b6ebc9e3e3821348b32df0618ca20788b4b4095b2d`) detectó respuestas de sesión anterior, desmontaje editorial al filtrar y salida oculta ante errores. El candidato v2 separa cache por sesión/principal, descarta respuestas obsoletas y mantiene herramientas y guardia de borradores durante filtros, con salida accesible incluso ante503/403. Los resultados de abajo conservan el corte v1; la QA v2 y su digest final constan exclusivamente en el manifiesto externo v2. Backend y semántica de pagos/fundadores se conservan.

## Resultado, autoridad y procedencia

Solicitud: dirigir Nortex con señales accionables y datos verificables. Noel confirmó que nadie había pagado Nortex al 30/09/2026 y que dio un año gratis a los fundadores. No existe una lista documentada de pertenencia ni fechas por cuenta en este lote.

El admin existente mezclaba métricas operativas, una estimación de ingresos desde ventas POS/capital, listado con datos personales y acciones de score/préstamos. Se conserva `/admin`, sus herramientas de presupuesto, edición, piloto y soporte WhatsApp, incluida la protección de salida con trabajo editorial pendiente. Se sustituye la superficie financiera por lectura de negocios, activación y situaciones que merecen revisión.

Base final: `43d8d77677bdc468ca2a3fec626b023996080903`, main remoto de `Noahstark23/nortex.20`, merge #233, 30/09/2026 06:10:04 UTC. La base inicial `096e25118f8a90855632ab12616c52e33263ce2f` era el HEAD del checkout principal, no main actualizado: se corrigió conservando el delta anterior en un patch y otro candidato. La QA final corresponde al candidato sobre 43d8d77 y al patch/manifiesto externo de esta entrega. No hay commit ni publicación remota.

Se conservaron los cambios posteriores de password-reset, WhatsApp, onboarding, POS y reportes. La integración compartida sólo modifica el montaje admin de `backend/server.ts`, añade modelos/índices al schema y compone el admin existente. Las rutas backend fintech legacy siguen como estaban en main: este lote no las habilita ni acredita su seguridad general. No hay botones ni llamadas de score, wallet, crédito, aprobación de préstamos o cobros en la nueva UI.

## Contrato y fuentes

`GET /api/admin/metrics` y `/api/admin/tenants` retornan el mismo `AdminOverview` tipado. La antigua respuesta de tenants era un array; el consumidor identificado es el admin, ahora actualizado a este contrato. Se exige JWT y `requireSuperAdmin`, que revalida usuario activo, rol y tenant en BD. No se acepta override de tenant/identidad en query. Sólo lectura, cache privado sin almacenamiento y 503 explícito si faltan tablas/conexión; una falla no se muestra como cero.

| Indicador | Fuente determinista y límite |
|---|---|
| Real/demo/interno/desconocido | `PlatformAccountEvidence` con referencia no vacía y verificación no futura. Sin evidencia queda UNKNOWN; sólo REAL entra en KPIs/cohortes |
| Catálogo y primera venta | Product; Sale COMPLETED/CREDIT_PENDING no anulada ni futura. No suma ventas como ingresos SaaS |
| Última actividad | Última venta, login o auditoría del comercio; excluye login/auditoría SUPER_ADMIN. No hay historial completo de sesiones |
| Recurrencia y cohortes | Ventas en al menos dos días civiles de Managua en últimos 30 días; últimos 12 meses con altas REAL. Es uso actual por cohorte, no retención D7/D30 histórica |
| Importación | Filas confirmadas en auditoría BULK_IMPORT/PRODUCT_BULK_UPDATED; no archivos, intentos ni errores no persistidos |
| Incidencias | PAYROLL_JOURNAL_SKIPPED y AssistantJob FAILED de 30 días. No representa todos los errores HTTP/offline/importación |
| Inventario/caja/fiado | Stock negativo, turno OPEN de más de 24 horas y facturas CREDIT_PENDING con saldo. Son señales para revisar, no errores o dolores de clientes demostrados |
| Fundadores y vencimiento | Pertenencia y ambas fechas explícitas verificadas. Alta, trial y estado ACTIVE no sustituyen evidencia ni generan fechas |
| Plan y recibos de Nortex | Etiqueta documentada y `PlatformPaymentEvidence` conciliado; suma Decimal por moneda USD/NIO, mes Managua. Vouchers APPROVED legacy no prueban cobro. MRR y suscripciones pagadas permanecen desconocidos |

Paginación de 50, orden estable, búsqueda parametrizada y filtros que abren cuentas afectadas. Las consultas SQL agregan por tenant en una transacción RepeatableRead. La respuesta excluye teléfono, correo, RUC, contraseñas, referencias privadas y comprobantes.

La migración preparada crea dos tablas e índices, sin backfill ni modificación de beneficios. Sólo se aplicó en bases nuevas propias de MySQL 8 descartable. La aplicación no escribe evidencia: no se implementó todavía un flujo de registro/conciliación. Antes de uso real, el responsable deberá revisar cómo aportar clasificación, pertenencia y fechas verificables. Hasta entonces, las cuentas permanecen desconocidas y accesibles en su cola de revisión. No iniciar cobros ni vencer/suspender beneficios desde este panel.

## Edición y recuperación

Editor: agente delegado de Codex; archivos exactos y hashes en el manifiesto externo. Un único editor integró server/schema/SuperAdmin. POS, caja, stock, contabilidad, password-reset y módulos WhatsApp no reciben cambios de comportamiento. La extracción reduce server de 12.874 a 12.710 líneas y SuperAdmin de 825 a 32; los módulos nuevos se contabilizan aparte.

No hay gasto de modelos, envío a clientes ni operación externa. Runtime Node 22.23.2 y paquetes instalados reutilizados localmente según autorización acotada; versiones, árboles y copia de respaldo de qs constan en `evidence/reused-dependencies.json` de la carpeta de entrega. No se verificó un tarball contra lockIntegrity: se registró el valor del lock y se comprobó igualdad del árbol instalado origen/destino. No hubo instalación, descarga o scripts de instalación. El patch y el candidato persisten; borrar la base/proceso propios no pierde el código. Cualquier edición posterior al patch invalida este corte de QA.

## Comprobaciones y límites

Todas las comprobaciones siguientes son posteriores a corregir dos defectos propios de la consulta: alias REAL reservado en MySQL y serialización UTC de GREATEST/COALESCE. No se atribuyeron al harness.

| Comprobación | Resultado |
|---|---|
| Vitest completo | 7.253 aprobadas, 0 fallos, 609 omitidas en 63 archivos; no se declaran aprobadas las omitidas |
| Omisiones | 607 casos en suites MySQL/integration opt-in y 2 casos HTTP de `batchWarehouseManualMovements` sin NORTEX_QA_BASE_URL; detalle externo `omitted-tests.json` |
| MySQL 8 + router/middleware reales | 37 comprobaciones aprobadas: upgrade SQL, ausencia de evidencia, UTC/managua 05:59/06:00, agregados por tenant, roles revalidados, privacidad, Decimal, paginación y ausencia de writes admin |
| UI jsdom | Carga, vacío, errores, stale, filtros, acceso denegado y salida editorial cubiertos por suite final |
| Chromium instalado, headless | 13 recorridos aprobados: sesión, lectura MySQL real sintética, filtros/páginas, evidencia, móvil 390px, vacío/error, OWNER con claim elevado, logout y ausencia de llamadas financieras |
| Prisma / TypeScript / diseño / build | Aprobados; diseño 137 archivos, sin incidencias. Build advierte chunks grandes, conservado sin cambiar configuración |
| Schema tras aplicar SQL nuevo | `prisma db push --skip-generate` sobre DB propia verificada: ya sincronizado |
| CI, staging, producción, aceptación humana | No ejecutados; ninguna publicación ni migración sobre BD existente |

La QA visual usa bundle compilado y router admin real sobre datos sintéticos, sin pantalla visible ni desbloquear la Mac. Los backends de herramientas secundarias quedan fuera del harness; no se presenta aceptación de esos flujos. La guardia editorial se valida separadamente en jsdom. Tampoco se validan uso real de comerciantes, rendimiento a escala productiva, dispositivos físicos ni el conjunto legacy fintech.

Siguiente condición de salida: revisión humana del patch, del contrato de clasificación/conciliación y de la migración antes de decidir cualquier integración. La autorización de construcción local no habilita publicación o deploy. Los informes históricos sobre ingresos, neobanco o presuntas pérdidas no alimentan estas cifras.
