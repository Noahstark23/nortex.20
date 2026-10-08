# Promoción de Nortex: código, recuperación y pruebas remotas

Candidato desplegado: `07f30c9a2f372abfeb31c2e3ae0c1c8fae7818fc`. Fecha del negocio: 8 de septiembre de 2026; las ejecuciones finales ocurrieron el 9 de septiembre en UTC. Este informe describe un candidato concreto y no autoriza otras promociones.

**Staging y producción están desplegados, sus pruebas financieras sintéticas pasaron y la observación posterior de 30 minutos terminó con 31 muestras aprobadas.**

## Evidencia por compuerta

| Compuerta | Resultado |
|---|---|
| CI final | [34293152828](https://github.com/Noahstark23/nortex.20/actions/runs/34293152828): cuatro jobs exitosos en el candidato exacto. El paso de mutación está omitido en ese run; la mutación local pertenece a la evidencia anterior. |
| Staging manual | [34296014918](https://github.com/Noahstark23/nortex.20/actions/runs/34296014918): destino Coolify, Auto Deploy apagado, pin, API/MySQL, SHA y caché comprobados. |
| Smoke staging | Aprobado con un tenant creado únicamente para QA; venta, devolución, anulación, cierre y reintentos conciliados. |
| Producción manual | [34296529913](https://github.com/Noahstark23/nortex.20/actions/runs/34296529913): autorización vigente, revalidaciones posteriores al environment y salud del mismo candidato aprobadas. |
| Smoke producción | Aprobado con otro tenant sintético independiente; mismo recorrido y conciliación. |
| Observación | 30 minutos, 31 muestras aprobadas: HTTP 200, API/MySQL sanos, SHA exacto, `Cache-Control: no-store` y uptime sin retrocesos. Es muestreo por minuto, no garantía de disponibilidad continua ni prueba de carga. |

[Evidencia estructurada de esta promoción](evidence/2026-09-08-consolidated/production-verification.json). La portada, recursos referenciados, robots y sitemap respondieron HTTP 200; esa comprobación pública no acredita un recorrido autenticado de interfaz.

Las imágenes se construyeron por entorno y tienen IDs diferentes. La identidad comprobada es el mismo SHA y la misma huella de los 17 archivos críticos; no se afirma que sean imágenes byte a byte idénticas. El contenedor productivo reportó Node 22.23.2 y Prisma 6.4.1. `node:22-slim` conserva el riesgo de parche mutable para construcciones futuras, documentado en la skill de despliegue.

## Prueba financiera y límites

El recorrido autenticado creó un producto contado con stock 10, precio 23 y costo 10, abrió caja con 100, vendió dos unidades, devolvió una con aprobación, vendió otra y la anuló con aprobación. Terminó con **stock 9, caja 123, diferencia cero y cuatro asientos balanceados**. Se conciliaron efectivo, inventario, IVA, ventas, devoluciones y costo del escenario. Los reintentos recuperaron las mismas operaciones; también se verificaron existencias por bodega, comprobante de cierre y revocación de las sesiones retiradas.

Las identidades se guardaron antes de cada mutación. No hubo resultado incierto, repetición con otra identidad ni uso de negocios reales como fixtures. El flujo del smoke no invoca proveedores de IA, cobros externos ni mensajes; no fue una medición integral del tráfico saliente del servidor. Las cuentas sintéticas quedaron deshabilitadas, sin correos, con el tenant cancelado y la historia financiera/auditoría conservada. Sus identificadores privados permiten excluirlas de métricas globales de altas/tenants/morosidad; no se borran movimientos para ocultar la prueba.

Este smoke no acredita farmacia/lotes, desconexión, lector/impresora, todas las variantes de pago, calidad del modelo ni una jornada comercial completa. Las pruebas locales y MySQL descartables tienen su propia [evidencia](evidence/2026-09-08-consolidated/local-verification.json).

## Reemplazo y recuperación

Durante el reemplazo productivo se observaron dos respuestas HTTP 503. Después el health volvió sano con el candidato exacto. No se midió la duración continua de indisponibilidad y no se declara un despliegue sin interrupción. La ventana posterior comienza después de recuperar la salud. C00 incorpora medir esta transición y ensayar una estrategia de reemplazo con recuperación de operaciones inciertas en staging.

Antes del despliegue se restauró un respaldo real de Nortex en MySQL 8 aislado: **111 tablas y 29.614 filas**. El schema candidato se aplicó dos veces; se preservaron 111 tablas anteriores y 241 agregados numéricos, se comprobaron 266 relaciones y se crearon 24 tablas. Los ensayos se limpiaron sin restaurar sobre producción. Esto acredita SQL/schema, no recuperación integral de originales privados.

El bloqueo de la API de Coolify 4.1.2 se resolvió actualizando el panel a **4.3.18** y realtime a **1.0.19**, con imágenes fijadas por digest. Antes se respaldaron PostgreSQL, configuración y SSH de forma opaca; se verificaron copia cifrada fuera del host, descarga/descifrado en Mac y restauración SQL aislada. El ensayo aplicó 53 migraciones, repitió sin cambios y verificó el SQL exacto de recuperación en una copia aislada. El upgrade conservó los servicios de aplicación/base/proxy durante la intervención del panel; la posterior promoción de Nortex sí reemplazó sus contenedores.

La sesión autenticada existente del panel y las guardas API funcionaron después. No se ejecutó un rollback integral con consumidores arrancados ni se acredita recuperación completa del host. Las actualizaciones automáticas del panel quedaron apagadas. El respaldo de Coolify conserva el valor anterior activado: una recuperación exige desactivarlo antes del arranque controlado de consumidores. No restaurar el estado viejo sin esa revisión.

## Controles y trabajo restante

Main exige PR y checks, los environments están limitados a main y las apps tienen Auto Deploy apagado. El propietario eligió `Noahstark23` para revisar producción: la aprobación quedó registrada, **sin atribuir revisión independiente**. Los tokens separados tienen alcance de equipo en Coolify; no se presenta como ACL por aplicación.

El despliegue publica implementaciones; no habilita por sí solo NortexGPT, extracción, promociones, WhatsApp privado ni workers. La inspección posterior confirmó los ocho interruptores de capacidades apagados y almacenamiento privado sin configurar, sin mostrar valores secretos. La activación requiere sus permisos, capacidades, almacenamiento y evaluación. El RAG conserva 12 artículos y búsqueda léxica; el piloto y sus revisiones humanas siguen pendientes.

C00 continúa abierto: medir carga representativa fuera de producción, alertas, recuperación de adjuntos y recorridos con dispositivos. El servidor mantiene 14.131 líneas y POS 5.924; este cierre documental no cambia su tamaño ni aumenta presupuestos. Continúa el [plan de estabilidad y RAG](../PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md) con el [equipo por dominio](../EQUIPO_DESARROLLO_NORTEX.md).

La evidencia operativa completa se conserva fuera del repositorio público, en el expediente privado de la promoción. No publicar dumps, configuraciones, claves, enlaces temporales ni datos de clientes. Los informes anteriores describen sus propios cortes; este documento actualiza el estado de esta promoción sin reescribir esos resultados.
