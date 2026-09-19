# Entrega documental: meta, roadmap y reglas de agentes

Fecha: **2026-09-19**. Alcance: estructura y reconciliación documental solicitadas
por el fundador. No incluye cambios de producto, integración de candidatos,
migraciones, nuevas pruebas financieras, llamadas IA ni despliegue.

## Documentos entregados

- [Meta administrativa](META_NORTEX_EQUIPO_ADMINISTRATIVO.md): trabajo de
  contabilidad, RRHH y finanzas; objetivo comercial y presupuesto separados.
- [Roadmap](ROADMAP_AGENTES_NORTEX.md): W01 durable primero; W02/W03, MCP y W04;
  H01/RAG y estabilidad en paralelo según dependencias, con IDs existentes.
- [Arquitectura](ARQUITECTURA_AGENTES_NORTEX.md) y
  [reglas](REGLAS_AGENTES_NORTEX.md): fuentes, autoridad, encargos/runs/propuestas,
  continuidad, confirmación, idempotencia, costo, retención y evidencia.
- [Contrato H01](CONTRATO_COMPRAS_CONVERSACIONALES_H01.md): A/B/C aceptados con
  precisiones, sin trasladar esa aprobación a artículos o implementación.
- [Estado](ESTADO_ACTUAL_NORTEX.md): checkout, candidatos y evidencia separados.
- [Equipo](EQUIPO_DESARROLLO_NORTEX.md) y
  [ficha de trabajo](templates/CONTRATO_TRABAJO_AGENTE.md): responsables, archivos
  por editor, resultados y condiciones de salida.

Se reconciliaron nueve documentos existentes mediante cambios puntuales:
README, índice docs, AGENTS, CLAUDE, skills `nortex-feature`/`nortex-rag`, plan de
transformación, plan RAG/estabilidad y plan RRHH. Se conservaron reglas actuales
de marca/cámara/inventario y el contenido histórico con su fecha. Nueve Markdown
nuevos, incluido este informe: **18 documentos** en total.

## Comprobaciones y revisión

La [verificación documental](evidence/administrative-goal-20260919/verification.json)
registra hashes, enlaces, diferencias, archivos preservados y limitaciones.

- Revisión independiente de orden/dependencias y coherencia de reglas. Se corrigió
  una posible megaintegración como prerrequisito de W01; A00 sólo integra las
  dependencias necesarias de cada lote.
- Se eliminó la receta que equiparaba API key disponible con permiso para gastar.
  La atribución admite identidad explícita de run, job o extracción según contrato;
  no inventa relaciones por tiempo. Se corrigió el ejemplo FULLTEXT de `PVC`.
- Las dos skills pasaron `quick_validate.py`. El Python inicial no tenía PyYAML;
  se usó un venv temporal con PyYAML 6.0.2, sin tocar dependencias del proyecto.
  Esa validación comprueba formato, no acredita comportamiento del producto.
- Hashes de **940 fuentes** de producto iguales al inicio; **49 archivos** del
  manifiesto editorial congelado preservados; rama e índice sin cambios.
  `server.ts` conserva 13.404 líneas y `POS.tsx` 6.853 en este checkout: delta cero.
  Las cifras del candidato editorial son otras; no atribuirlas a esta carpeta.

No se reejecutaron Prisma, TypeScript, Vitest, integración MySQL, mutación, diseño
o build: no cambió código de producto. La compuerta financiera antes rechazada
no se reintentó. Las pruebas históricas de ayuda conservan su propio expediente;
esta entrega no acredita modelo real, piloto, CI, staging o producción.

## Próximo paso establecido

Elegir el candidato del lote y preservar sus dependencias; reproducir y reparar
H01-1, mientras se concreta A01/W01 mínimo. El primer resultado completo será
revisar una semana, guardar faltantes, retomar, explicar diferencias y aceptar un
informe exacto. Esta entrega deja ese criterio y sus reglas listos para desarrollo.
