# Mantenimiento documental de Nortex

El estado actual se consulta en [ESTADO_ACTUAL_NORTEX](ESTADO_ACTUAL_NORTEX.md). Esta revisión reconcilia guías operativas, skills y plan contra el candidato `484f58a`; no transforma todos los informes antiguos en documentación vigente ni afirma revisar cada hecho legal, comercial o histórico.

## Autoridad y propietarios

| Documento | Propietario | Cuándo revisarlo |
|---|---|---|
| AGENTS.md y CLAUDE.md | Integración | Cambian contratos comunes, seguridad, QA o ubicación de dominio |
| Estado actual y expediente de release | Integración + QA | Cambia candidato, evidencia o entorno observado |
| Plan C00/D00–D14 | Producto + responsables de dominio | Se implementa o adjudica una tarea; registrar evidencia, no solo marcar checkbox |
| Equipo/perfiles | Integración | Cambian ownership, capacidad del entorno o responsabilidades |
| Runbooks de QA/promoción y skills | Dominio + QA/Plataforma | Cambia script, flag, comando, gate o contrato al que remiten |
| Informes fechados y evidencia | Autor del informe | Añadir corrección fechada o enlace al sucesor; preservar resultados originales |
| Ayuda al usuario | Contenido + revisor humano del producto | Cambia comportamiento o procedimiento publicado |

No usar una skill como inventario estático de conteos, rutas con líneas o resultados actuales. Preferir símbolos, scripts, tests y un documento de estado. La actualización de una skill conserva el alcance del usuario, contratos financieros y límites de autorización; no añade aprobación para trabajo reversible ya autorizado ni permite operaciones externas por inferencia.

## Cobertura de esta revisión

El [inventario](evidence/documentation-20260908/inventory.json) clasifica los Markdown del candidato por ruta. **Clasificado no significa contenido íntegramente validado.** Las revisiones semánticas se concentran en entradas vigentes, plan, skills y runbooks afectados. Los informes históricos se conservan con fecha/candidato; los documentos no revisados mantienen esa limitación explícita en el inventario.

Comprobaciones: frontmatter y referencias de perfiles/skills; comandos contra package/scripts; límites de monolitos contra tests; guías financieras contra servicios; revisión independiente por escenarios. Una validación de YAML, enlaces o texto no acredita producto, seguridad universal ni exactitud legal. Las pruebas de producto ejecutadas pertenecen al expediente de su SHA.

## Regla de actualización

Una entrega debe indicar problema, cambio, archivos/contratos y validación. Si cambia el comportamiento del producto, actualizar sus instrucciones en el mismo lote. Si solo se corrige una receta documental, ejecutar validación proporcional y conservar el resultado anterior como histórico. Nunca subir presupuestos, desactivar gates ni fabricar evidencias para reconciliar un documento.

No indexar estas guías internas, skills, conversaciones, facturas o informes privados en el RAG de usuarios. La ayuda publicada tiene su propio contrato de autorización, revisión y versión.
