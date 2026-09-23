# Estado verificable de Nortex y sus agentes

Corte: **2026-09-19**, preparación local solicitada. Existe un candidato reunido
sobre `main`; todavía no está aprobado ni desplegado. La
[entrega](NORTEXGPT_ENTREGA_PREPARACION_2026-09-19.md) y el
[expediente de promoción](NORTEXGPT_PREPARACION_DEPLOY_2026-09-19.md) separan código,
pruebas, estado remoto y bloqueos. Dirección: [meta](META_NORTEX_EQUIPO_ADMINISTRATIVO.md)
y [roadmap](ROADMAP_AGENTES_NORTEX.md).

## Procedencia

| Fuente | Representa | Límite |
|---|---|---|
| [Candidato reunido](/Users/stark/Developer/Nortex/candidates/nortexgpt-release-ready-20260919) | Copia ordinaria de main `67f1832502ee68ef67ac12b0803bdbfce48a4cef`, con presupuesto, W01/W01B, biblioteca/editorial, H01-1/2 y A01.W01.1–2 | Sin `.git`, sin commit nuevo ni deploy. Identidad por manifiesto/parche, no por el SHA de la base |
| [Checkout original](/Users/stark/Documents/GitHub/nortex.20) | `codex/caja-nica-retention`, HEAD `d326c589…`; trabajo previo conservado | No se sustituyó con el candidato. No ejecutar su antigua receta de deploy para publicar el nuevo conjunto |
| [Release congelado](/Users/stark/Developer/Nortex/candidates/release-20260908) | Base histórica `d44043b0…` | Fuente histórica, no versión remota actual |
| [Ayuda](/Users/stark/Developer/Nortex/candidates/nortexgpt-knowledge-20260919) y [editorial](/Users/stark/Developer/Nortex/candidates/nortexgpt-editorial-20260919) | D01/D03/editor y dependencias previas | Se portaron archivos explícitos; evidencia original no se hereda automáticamente |
| [Identidad H01-1](/Users/stark/Developer/Nortex/candidates/nortexgpt-catalog-20260919) | Selección por ID y catálogo sobre el checkout anterior | Sus 324 pruebas deterministas y 26 comprobaciones MySQL corresponden a ese parche, no al nuevo conjunto |
| [Preparación H01-2](/Users/stark/Developer/Nortex/candidates/nortexgpt-ready-20260919) | Copia intermedia para desarrollar conflictos entre factura y conversación | Sus cambios se portaron al candidato reunido; no promover esta copia intermedia |
| [Revisión humana H01](/Users/stark/Developer/Nortex/handoffs/nortexgpt-human-review-20260919/batch01/CONTRATO_Y_BRECHAS_H01.md) | A/B/C aprobados con precisiones | No artículo completo, expected del modelo, publicación o implementación |

Los enlaces locales requieren esta estación. El paquete de entrega conserva un
manifiesto y parche contra la base para transportar el candidato sin mezclarlo con
el checkout. Los cambios remotos de marca, inventario, caja, fiscal y POS se
preservaron desde main, en vez de reemplazarlos con versiones antiguas.

## Capacidad y condición pendiente

| Capacidad | Implementado en el candidato reunido | Falta para acreditar el resultado |
|---|---|---|
| Orquestador | Herramientas cerradas, evidencia, límites de iteraciones/tiempo y presupuesto | Modelo real por recorrido; consumo conjunto entre procesos/canales y piloto |
| Presupuesto | US$2 iniciales por negocio/mes; solicitud y aprobación de Nortex hasta US$10, global US$20; autoridad explícita | Integración financiera obligatoria del conjunto y configuración comprobada del entorno |
| W01/W01B | Lecturas de revisión semanal e investigación de cierres; snapshots y actuales separados | Cifras contrastadas en MySQL del candidato, informe versionado/aceptado y utilidad |
| A01.W01.1–2 | Guardar revisión propia, notas, espera, reanudación y cancelación; eventos con UUID/CAS, permisos y caducidad | Reinicio/concurrencia/limpieza con MySQL real. No incluye asignación a otros, aceptación final ni correcciones de caja |
| RAG | Doce artículos LEGACY, búsqueda léxica, referencias, ciclo de versión y editor autenticado; revocación parcial de permisos retira contenido del panel | 48 borradores D02 sin aprobar/publicar; benchmark, expected humanos y modelo real. Salir de SuperAdmin puede perder un borrador editorial sin enviar |
| Compras H01-1 | Identidad exacta e independiente de producto/proveedor, texto preservado y revisión invalidada | Aceptación visual en dispositivos y registro financiero del candidato |
| Compras H01-2 | Declaración y documento separados; conflicto 50/40 exige elección humana; fuente original inmutable, edición invalida revisión y respuesta perdida se recupera leyendo la misma propuesta | Extracción real, integración financiera y QA completa del flujo. No implementa parciales H01-3 ni anticipos H01-4 |
| RRHH/Finanzas y MCP | Motores y diseño previos aprovechables | W02/W03 y servidor MCP externo sobre capacidades aceptadas |

## Evidencia del conjunto

El expediente `release-evidence/ready-20260919/verification.json` registra la
selección determinista ejecutada, el toolchain, Prisma validate/generate,
TypeScript, diseño y build de producción/SEO. Las pruebas de UI usan jsdom; no
acreditan navegación real en dispositivos. La selección excluye suites
`.integration.`: cero casos omitidos en ella no significa integración aprobada.

Se reprodujeron y repararon el reemplazo 50/40, exposición de ayuda tras revocación
parcial y confirmación visible antes de verificar de nuevo la identidad de catálogo.
La recuperación conserva datos/identidad sin repetir una escritura financiera.
No se llamó al proveedor ni se cambiaron flags, cupos reales o contenido publicado.

La compuerta financiera anterior fue rechazada por revisión automática; no se
reintentó por otra herramienta ni se acreditó con estos tests. Quedan sin ejecutar
para este conjunto integración MySQL obligatoria, mutación pertinente, upgrade de
migraciones/restauración, QA real del modelo y piloto.

## Estado remoto, separado

Lecturas de esta entrega: CI de la **base** `67f1832…` aprobada; staging de esa base
falló verificando destino Coolify antes del webhook. Health de staging y producción
respondió 200, API/base disponibles, y SHA `98e54afad4bfa7a0ef5ae99c902102d40d0400ff`.
Es una versión anterior. Las horas, runs y límites están en el
[expediente](NORTEXGPT_PREPARACION_DEPLOY_2026-09-19.md#estado-remoto-observado).
No se verificaron capacidad del Droplet, configuración completa de Coolify ni
restauración actual. No existe CI ni staging del nuevo conjunto local.

## Siguiente condición

Cerrar QA de persistencia/finanzas y schema del candidato; investigar el error
saneado de destino staging; luego crear un SHA candidato y verificar CI y staging
sobre él dentro de una promoción autorizada. En producto siguen A02.W01.3–4 y la
revisión de contenido completo. No volver a pedir aprobación de A/B/C ni convertir
esa aprobación en publicación. H01-3/4 se entregan por contrato separado.
