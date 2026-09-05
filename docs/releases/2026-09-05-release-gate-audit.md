# Auditoría de control de release — 2026-09-05

## Estado y alcance

Esta auditoría documenta un **candidato local**, no un cambio activo. Al iniciar
la reparación, `origin/main` apuntaba a
`d9cdd7cefb1724ab2fab65458f6aadaf531c339a`; el trabajo permanece en la rama
local `codex/release-gate-20260905`. No se hizo push, merge, dispatch de
workflows, webhook, staging ni producción.

La revisión de GitHub/Coolify fue de sólo lectura y no mostró secretos,
credenciales ni datos de clientes. Sus observaciones son una foto de auditoría:
deben confirmarse otra vez por el responsable antes de cambiar configuración
externa.

**Estado de producción: BLOQUEADA Y NO AUTORIZADA.** Un candidato verde local no
es una promoción ni permite inferir una aprobación de producto.

## Defecto confirmado

La ruta anterior mezclaba verificación y despliegue. En el `main` remoto
observado seguía una ruta heredada de producción dentro de `ci.yml`; además, el
repositorio y sus environments carecían de controles externos suficientes para
un sistema que maneja dinero e inventario. En esas condiciones, un push —incluso
uno documental— no debe poder interpretarse como autorización de staging o
producción.

## Reparación presente sólo en el candidato

| Área | Contrato agregado o corregido | Evidencia local | No demuestra |
| --- | --- | --- | --- |
| CI | `ci.yml` verifica código e integración aislada; no contiene el webhook ni un job de staging/producción. | Inspección del workflow candidato y pruebas de contrato. | Que el `main` remoto ya lo tenga o que CI remoto haya corrido. |
| Staging | `release-staging.yml` requiere dispatch desde `main`, SHA completo, `STAGE <SHA>`, CI terminal del mismo SHA y revalidación luego del environment. | Pruebas de workflow/validación en el candidato. | Un staging real, su aprobación o su salud. |
| Producción | `release-production.yml` requiere SHA completo, `PROMOTE <SHA>`, CI y staging válidos, y revalidación después de la aprobación del environment. | Pruebas de workflow/validación en el candidato. | Un deployment, autorización de producto o rollback disponible. |
| Origen y salud | La configuración que llega a los webhooks de staging y producción exige un origen público raíz sin credenciales, query ni fragmento; el verificador falla ante redirección, 503, base/API caída o SHA distinto. `/api/health` marca la respuesta `no-store`. | Pruebas de workflow, `verify-deployed-release` y la compuerta local. | Identidad real entre `PROD_URL` y la aplicación de Coolify. |
| Dinero e inventario | La compuerta aislada usa MySQL 8, backend loopback, datos sintéticos y falla si falta una suite o hay fallos, omitidos o `todo`. | 12 suites / 83 casos verdes, sin omitidos ni `todo`. | Datos de usuarios, CI remoto, staging o producción. |
| Instrucciones | Los runbooks y guías de agentes del candidato separan implementación, QA, staging y producción, y prohíben comandos ad hoc contra datos reales. | Revisión documental local. | Que una configuración externa o un agente futuro cumpla por sí solo. |

Como control complementario, la reejecución completa de Vitest terminó con
**306 archivos y 4,076 pruebas aprobadas**. También reportó **11 archivos y 69
pruebas omitidas** dependientes de QA/MySQL fuera del entorno normal; no se
cuentan como evidencia aprobada. La compuerta aislada ejecutó 12 de esos
recorridos HTTP/QA con MySQL temporal después de añadir el assert de
`Cache-Control: no-store`.

## Reparaciones funcionales descubiertas al verificar

La compuerta aislada encontró un contrato de inventario incorrecto: la ruta de
ajuste transformaba `WAREHOUSE_REQUIRED` e `INSUFFICIENT_STOCK` en `409` aunque
el contrato exige `400`. El candidato corrige el orden del manejo de `StockError`
sin alterar el tenant, la transacción ni el movimiento atómico de stock.

También se actualizaron los recorridos de pedidos/devoluciones para exigir el
expediente de corrección aprobado y conservar el rechazo cuando falta
`correctionRequestId`. Al cerrar la auditoría, la compuerta también detectó una
ronda HTTP de lote+bodega que no llevaba el sufijo habitual; ahora exige registrar
además cada prueba que use `NORTEX_QA_BASE_URL`. Esto prueba contratos locales,
no una observación de venta de cliente ni una prueba de UI autenticada.

## Bloqueos externos y no probados

1. La configuración remota observada tenía `main` sin protección y environments
   sin las restricciones requeridas. Antes de promover, el dueño debe comprobar
   y configurar protección de rama, límite de environments a `main`, revisión
   independiente y ausencia de bypass/autoaprobación. No se modificó nada de eso
   durante esta auditoría.
2. En la observación de sólo lectura, faltaban el flag
   `NORTEX_PRODUCTION_DEPLOY_ENABLED` y el secreto de lectura
   `COOLIFY_PROD_READ_TOKEN`. Su presencia se debe comprobar sin revelar valores;
   no se asumió que estén configurados ahora.
3. El contrato disponible de Coolify identifica aplicación y SHA, pero no aporta
   un campo documentado y verificable que una el origen público con `PROD_URL`.
   No se inventó ese dato. Infraestructura debe aportar un payload/fixture
   saneado y versionado o una verificación independiente de esa identidad antes
   de producción.
4. No existe evidencia de CI remoto, staging del SHA candidato, health remoto,
   smoke autenticado sintético, QA visual autenticada ni prueba de periféricos.

## Salida de la auditoría

El siguiente estado requiere, en este orden: revisión e integración autorizadas
del SHA; CI exitoso de ese SHA; dispatch manual de staging con su confirmación y
health correspondiente; recorridos QA sintéticos autenticados; demostración
humana del producto final; y autorización de producción separada que nombre SHA,
alcance, ventana, responsable y rollback. Si falta uno, la promoción queda
bloqueada.
