# Estado verificable de Nortex y sus agentes

Corte actualizado: **2026-09-19**. H01-1 ya tiene implementación y QA local
integradas según su [informe](NORTEXGPT_IDENTIDAD_CATALOGO_2026-09-19.md).
Los demás alcances conservan su evidencia propia; no se consultó producción ni se
hicieron llamadas pagadas en este lote. Dirección en la
[meta](META_NORTEX_EQUIPO_ADMINISTRATIVO.md); siguiente trabajo en el
[roadmap](ROADMAP_AGENTES_NORTEX.md).

## No hay una sola copia consolidada

| Fuente | Qué representa | Límite |
|---|---|---|
| Este checkout `/Users/stark/Documents/GitHub/nortex.20` | Rama `codex/caja-nica-retention`; 585 entradas con cambios al comenzar H01-1 | Contiene cambios de marca/cámara/inventario; no contiene todos los incrementos posteriores. No reemplazarlo con una copia |
| [Release congelado](/Users/stark/Developer/Nortex/candidates/release-20260908) | Base registrada `d44043b0dcbc05b7da04a231dba977936383bda9` | Fuente de los candidatos posteriores; no es prueba del SHA que hoy sirve producción |
| [Candidato de ayuda](/Users/stark/Developer/Nortex/candidates/nortexgpt-knowledge-20260919) | D01 y primer D03, sobre base posterior | Copia ordinaria; su evidencia sólo acredita su alcance |
| [Candidato editorial](/Users/stark/Developer/Nortex/candidates/nortexgpt-editorial-20260919) | Añade editor autenticado y conserva presupuesto/W01/W01B previos | No tiene `.git`; no equivale a integración en este checkout ni despliegue |
| [Candidato de identidad](/Users/stark/Developer/Nortex/candidates/nortexgpt-catalog-20260919) | H01-1 sobre copia de este checkout, con marca existente; parche limitado reintegrado tras QA | No integra presupuesto/W01/editorial ni acredita registro financiero |
| [Revisión humana H01](/Users/stark/Developer/Nortex/handoffs/nortexgpt-human-review-20260919/batch01/CONTRATO_Y_BRECHAS_H01.md) | A/B/C validados con precisiones y contraste estático | No aprueba artículo completo, publicación o implementación |

Los enlaces absolutos son referencias de esta estación. Antes de trasladar el
proyecto, empaquetar evidencias por manifiesto y actualizar sus referencias;
no sustituirlas por enlaces relativos a módulos que aquí todavía no existen.

## Implementación y evidencia disponible

| Capacidad | Hecho acreditado por la fuente local | Pendiente |
|---|---|---|
| Orquestador | En candidato: herramientas cerradas, resultados devueltos al modelo, cuatro iteraciones/60 s, evidencia y presupuesto | Calidad real por recorrido; límite global entre entornos/canales |
| Contabilidad W01/W01B | Revisión semanal de snapshots e investigación de cierre, separando datos históricos/actuales | Encargo durable, asignación, aceptación, conciliación completa y piloto |
| Trabajo de varios días | Runs/checkpoints existentes | Coordinador `WorkItem`/pasos, espera, aportes, informe aceptado y continuidad completa |
| RAG | Doce artículos LEGACY léxicos; D01/D03 y editor autenticado en candidato editorial | 48 borradores D02 pendientes; publicación humana, benchmark y evaluación real; no confundir infraestructura editorial con contenido aprobado |
| Compras | H01-1 implementado y comprobado localmente: selección exacta, homónimos, texto original y revisión invalidada | H01-2/3/4: conflictos antes de adoptar valor, cantidades por fuente, parciales y anticipos; QA financiera no acreditada |
| RRHH / Finanzas | Motores y lecturas aprovechables | W02/W03 completos; separación de efectos legacy y evaluación por dominio |
| MCP | Diseño disponible | Servidor externo, autorización delegada, consentimiento y cliente real probados |
| Presupuesto | Candidato posterior: US$2 iniciales y aumento aprobado hasta US$10, global US$20 | Checkout conserva la política anterior; consolidar antes de habilitar. Documentar no cambia el cupo efectivo |

[W01 histórico](/Users/stark/Developer/Nortex/candidates/nortexgpt-editorial-20260919/docs/NORTEXGPT_REVISION_SEMANAL_CAJA_2026-09-09.md)
y [W01B histórico](/Users/stark/Developer/Nortex/candidates/nortexgpt-editorial-20260919/docs/NORTEXGPT_INVESTIGACION_CIERRES_2026-09-12.md)
conservan sus pruebas originales; no fueron repetidas en esta entrega ni prueban
un encargo W01 completo.

El [expediente editorial](/Users/stark/Developer/Nortex/release-evidence/editorial-20260919/verification.json)
registra 198 pruebas deterministas y 21 de MySQL 8 dedicadas a ayuda, sin omitidos;
Prisma, TypeScript, diseño y build aprobados en ese candidato. UI en jsdom, sin
recorrido real de dispositivos. No acredita QA financiera, calidad del modelo ni
producción. Borradores editoriales sin enviar pueden perderse al abandonar
SuperAdmin; ocultar el panel sí los conserva en memoria.

## Bloqueos y siguiente condición

- La compuerta financiera anterior fue rechazada por revisión automática. No se
  reintentó en los lotes de ayuda ni en esta documentación; no se declara aprobada.
- Revisar contenido completo/versionado y expected pertinentes antes de evaluar
  modelo o publicar. A/B/C ya están validados como conductas, no volver a pedir
  esa misma aprobación ni atribuirle una firma editorial autenticada.
- H01-1 se basó en este checkout y conservó `Product.brand`. Su parche aislado
  tiene 324 pruebas deterministas y 26 comprobaciones MySQL de catálogo, sin
  omisiones; cuatro lecturas simultáneas y cola cancelable. Falta reconciliar los
  otros candidatos y continuar A01/W01 mínimo con la
  [ficha de trabajo](templates/CONTRATO_TRABAJO_AGENTE.md).
- CI, staging, producción, capacidad del Droplet, restauración conjunta y resultados
  del piloto **no se revalidaron ahora**. Los informes fechados conservan alcance;
  no usar su último SHA como afirmación del estado remoto actual.

El [informe documental anterior](ENTREGA_META_AGENTES_2026-09-19.md) mantiene su
alcance. El [informe H01-1](NORTEXGPT_IDENTIDAD_CATALOGO_2026-09-19.md) registra
la implementación posterior y sus límites. Ninguno acredita agentes completos,
calidad del modelo, piloto o producción.
