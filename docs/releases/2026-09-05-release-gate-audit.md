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
| Origen, identidad y salud | Cada environment exige por separado un origen HTTPS raíz confiable de API Coolify, UUID de app, token de solo lectura y webhook que coincida con ese origen/UUID antes de llamarlo. `STAGING_URL`/`PROD_URL` deben ser orígenes públicos raíz; el verificador falla ante redirección, 503, base/API caída, SHA distinto o ausencia de `Cache-Control: no-store`. | Pruebas locales de workflow, destino Coolify y `verify-deployed-release`. | Variables/apps reales configuradas o identidad real entre URL pública y la aplicación Coolify. |
| Dinero e inventario | La compuerta aislada usa MySQL 8, backend loopback, datos sintéticos y falla si falta una suite o hay fallos, omitidos o `todo`. | 12 suites / 89 casos verdes, sin omitidos ni `todo`. | Datos de usuarios, CI remoto, staging o producción. |
| Invitaciones | La ruta pública `/invite/:token` comparte el shell de autenticación y no persiste un JWT parcial. Aceptar y cancelar reclaman sólo `PENDING` dentro de transacciones serializables; el enlace cancelado no revela correo, rol ni negocio, y la aceptación sólo devuelve `id` y `businessName` del tenant. | Prueba de interfaz, validación Zod y carrera real en MySQL. | Recorrido visual autenticado completo ni entrega de correo real. |
| Frontera de secretos | Vite ya no inyecta `GEMINI_API_KEY` ni otra variable sin prefijo público al bundle del navegador. | Test de contrato y build con centinela: el valor no aparece en `dist`. | Configuración real de secretos de backend o proveedores. |
| Instrucciones | Los runbooks y guías de agentes del candidato separan implementación, QA, staging y producción; exigen autorización externa separada y prohíben comandos ad hoc contra datos reales. | Revisión documental local y guard de comandos focalizado. | Que una configuración externa o un agente futuro cumpla por sí solo. |

## Evidencia ejecutada de cierre local

- Vitest normal: **313 archivos y 4,137 pruebas aprobadas**; además informó
  **11 archivos y 75 pruebas omitidas** que pertenecen a recorridos dependientes
  de QA/MySQL. Los omitidos no se cuentan como aprobación.
- Compuerta requerida de integración: **12 suites y 89 casos** con MySQL 8
  temporal, sin fallos, omitidos ni `todo`.
- Contratos focalizados de release, CI, destino Coolify, health, invitación,
  frontera de secretos y guard: **11 suites y 224 casos aprobados**.
- Prisma validate, TypeScript, comprobación del sistema de diseño, build de
  navegador con un valor centinela y prerender SEO completaron correctamente.
  El centinela no apareció en `dist`; el prerender generó 71 rutas y 72 URL del
  sitemap.
- La mutación global se inició como parte de la precompuerta pero se detuvo de
  forma deliberada antes de completarla: su estimación real era de varias horas
  y no hay cambio de algoritmo de dinero/inventario que pueda acreditarse con
  ella. Por tanto, no se presenta como evidencia verde.

Las advertencias conocidas de Browserslist desactualizado y del tamaño del chunk
`xlsx` no causaron fallos, pero siguen siendo deuda separada y no una aprobación
visual o de producción.

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

La revisión también volvió operativa la aceptación de invitaciones: la nueva ruta
pública usa el mismo shell accesible de autenticación, valida el enlace antes de
mostrar el formulario y devuelve al login canónico después de crear la cuenta. La
aceptación concurrente ya no convierte un conflicto único en `500`; aceptación y
cancelación compiten atómicamente por el estado `PENDING`, con cobertura contra la
cancelación ficticia posterior a una aceptación. La UI no persiste el JWT devuelto
por ese endpoint público. Esto es evidencia local de contrato y de integración, no
una demostración visual autenticada del producto completo.

La validación pública vence sólo una fila que siga `PENDING`, de modo que una
lectura vencida no puede sobrescribir una cancelación o aceptación ganadora. La
aceptación descarta primero tokens inexistentes, usados, cancelados o vencidos y
aplica un límite estricto por token antes de ejecutar bcrypt; el claim serializable
permanece como autoridad final ante reintentos y carreras.

## Bloqueos externos y no probados

1. La configuración remota observada tenía `main` sin protección y environments
   sin las restricciones requeridas. Antes de promover, el dueño debe comprobar
   y configurar protección de rama, límite de environments a `main`, revisión
   independiente y ausencia de bypass/autoaprobación. No se modificó nada de eso
   durante esta auditoría.
2. En la observación de sólo lectura, faltaban el flag
   `NORTEX_PRODUCTION_DEPLOY_ENABLED` y el secreto de lectura
   `COOLIFY_PROD_READ_TOKEN`. El candidato no configuró ni verificó variables,
   UUIDs, tokens, webhooks o apps reales de staging/producción. Su presencia y
   alcance se deben comprobar sin revelar valores; no se asumió que estén
   configurados ahora.
3. El nuevo contrato local exige que el origen HTTPS de API Coolify, UUID, token
   de lectura y webhook coincidan por environment antes del webhook. Aun así, no
   aporta un campo externo verificable que una cada origen público con
   `STAGING_URL`/`PROD_URL`. No se inventó ese dato. Infraestructura debe aportar
   un payload/fixture saneado y versionado o una verificación independiente de
   esa identidad antes de staging y producción.
4. No existe evidencia de CI remoto, staging manual exitoso del SHA candidato,
   health remoto con `Cache-Control: no-store`, smoke autenticado sintético, QA
   visual autenticada ni prueba de periféricos.

## Salida de la auditoría

El siguiente estado requiere, en este orden: revisión e integración autorizadas
del SHA; CI exitoso de ese SHA; identidad Coolify externa configurada y comprobada
por environment; dispatch manual de staging exitoso con su confirmación, SHA y
health `no-store`; recorridos QA sintéticos autenticados; demostración humana del
producto final; y autorización de producción separada que nombre SHA, alcance,
ventana, responsable y rollback. Si falta uno, la promoción queda bloqueada.
