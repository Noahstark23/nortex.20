# Equipo de desarrollo de Nortex

Organización de trabajo: **2026-09-19**. Estos perfiles construyen el
[equipo administrativo del cliente](META_NORTEX_EQUIPO_ADMINISTRATIVO.md).
Se asignan por tarea; no describen procesos permanentes ni garantizan perfiles
instalados en este checkout. La configuración observada del candidato se conserva
como [referencia histórica](/Users/stark/Developer/Nortex/candidates/nortexgpt-editorial-20260919/docs/EQUIPO_DESARROLLO_NORTEX.md).

| Responsabilidad | Entrega del responsable | Revisión |
|---|---|---|
| Integración | Base del lote, contratos, archivos compartidos y evidencia final | Revisión independiente del cambio y sus límites |
| Finanzas/Contabilidad | Lecturas W01/W03, compras y contratos de efectos | QA de expected, conciliación y transacciones; persona del dominio |
| Dominio laboral | W02, separación cálculo/persistencia y privacidad por campo | Revisor laboral/contable identificado; pago en lote separado |
| Plataforma | Persistencia A01, workers, límites, pools, recuperación y observabilidad | Reinicios, duplicados, revocación y mediciones de capacidad |
| Inteligencia | Orquestación, herramientas, RAG, abstención y evaluación | Fuentes, permisos antes del modelo, costo y calidad real |
| POS/Experiencia | Bandeja mínima, revisión, continuidad, lector/atajos y carrito | Recorrido móvil/escritorio, teclado, red y navegación |
| QA | Criterios independientes, regresiones y clasificación de evidencia | No acreditar sólo con explicación del autor ni con casos omitidos |
| Clean Code | Límites de módulos y extracciones caracterizadas | Delta origen/destinos/total, contratos y presupuesto de origen |

Antes de cada lote completar la [ficha](templates/CONTRATO_TRABAJO_AGENTE.md):
editor por dominio, lista exacta de archivos permitidos, interfaces/errores,
dependencias y orden de integración. No asignar todos los perfiles si no hay
trabajo independiente. Respetar límites del entorno sin aumentarlos para acelerar.

`backend/server.ts`, `components/POS.tsx`, schema, migraciones, tipos compartidos,
registro de herramientas, package/lockfile, CI y presupuestos tienen un único
integrador. El resto entrega contratos/parches de sus archivos; revisión de un
archivo no habilita edición. No revertir cambios ajenos.

## Distribución del siguiente ciclo

1. Integrador: candidato explícito; reconciliar fuentes y cambios existentes.
2. Compras + POS: H01-1 con archivos separados y QA de identidad/etiquetas.
3. Plataforma + Inteligencia: contrato mínimo A01/W01, persistencia y continuidad.
4. Contabilidad + POS: informe, excepciones y aceptación W01 sobre lecturas existentes.
5. RAG + revisión humana: H01-5/D02 y corpus; no publicar ejemplos por estar discutidos.
6. QA + Plataforma: evidencia del lote, POS disponible, recuperación y costo;
   Producto conduce validación de utilidad antes de ampliar capacidades.

Los revisores humanos aportan conocimiento del negocio y validan expected,
procedimientos y resultados; no se reemplazan por consenso de agentes. Los
pendientes de revisión se solicitan sobre una versión concreta, sin bloquear
trabajo independiente ni inventar aprobaciones.
