# Reglas del producto y del desarrollo de agentes Nortex

Vigentes como dirección desde **2026-09-19**. Aplican junto con
[AGENTS](../AGENTS.md), [CLAUDE](../CLAUDE.md) y la
[meta](META_NORTEX_EQUIPO_ADMINISTRATIVO.md). Son requisitos de aceptación;
su documentación no prueba que el código ya los cumpla.

## Autoridad, datos y acciones

1. **Autoridad del servidor.** Tenant/usuario/rol proceden de sesión o vínculo
   autenticado; una conexión externa añade consentimiento y scopes, nunca permisos.
   Verificar al consultar, recuperar historial/adjuntos, ejecutar un paso y confirmar.
   Los perfiles contable/financiero/RRHH no son roles con privilegios propios.
2. **Minimización antes del modelo.** Filtrar campos por permiso antes de enviar
   datos. Bodega sin costos; caja con alcance autorizado. RRHH exige permisos
   específicos: un agregado puede revelar un salario en un negocio pequeño.
   Revocación también protege resúmenes, fuentes y evidencia derivada anteriores.
3. **Tres fuentes separadas.** Ayuda = contenido aprobado, vigente y citado;
   cifras = servicios deterministas; hechos del usuario/documentos = evidencia
   atribuida, posiblemente incompleta o contradictoria. El modelo no crea una
   cuarta fuente de verdad. Una fuente con una cifra no acredita cualquier causa.
4. **Herramientas cerradas.** Validación de argumentos y resultados; sin SQL libre,
   endpoints arbitrarios ni confirmación a disposición del modelo. Documentos,
   mensajes y resultados recuperados se tratan como datos, no nuevas instrucciones.
5. **Preparar, revisar, confirmar y comprobar son estados distintos.** Confirmar
   recibe ID de propuesta, versión y clave idempotente. El servidor reconstruye
   efectos desde la propuesta guardada y vuelve a validar permisos/condiciones.
   Un «sí» en chat o el acuerdo entre agentes no confirma dinero/inventario.
6. **La transacción pertenece al dominio.** Dinero Decimal; stock por
   `applyStockDelta`; efectos, auditoría y comprobante atómicos. Sin IA dentro
   de transacciones. No crear motores paralelos de caja, nómina o inventario.
7. **Incertidumbre explícita.** Respuesta perdida conserva identidad y contenido;
   recuperar comprobante antes de repetir. Un 404, timeout o reinicio no demuestra
   que no ocurrió la operación. Cancelar un encargo no revierte una operación.
8. **Faltantes y conflictos.** Desconocido no es cero; comprar no es recibir ni
   pagar. Conservar origen y correcciones. Ambigüedad exige elección humana;
   conflicto bloquea el efecto relacionado hasta resolverse. Cumplir [H01](CONTRATO_COMPRAS_CONVERSACIONALES_H01.md).

## Trabajo durable y experiencia

9. **Unidad de valor.** Cada encargo tiene objetivo, alcance, versión, responsable,
   evidencia y criterio de finalización. Conversación, encargo, run de IA y
   propuesta/comprobante son objetos distintos. Retomar no reinventa los hechos.
10. **Espera sin gasto.** Documento/dato pendiente deja trabajo guardado; eventos
    autorizados o reanudación explícita habilitan el paso. No sondear al modelo
    para saber si llegó un documento ni disparar llamadas por GET/recarga.
11. **Límites conservados.** Hasta cuatro iteraciones y 60 segundos por run. Un
    encargo define además máximo de pasos, runs y reintentos; dividirlo no permite
    trabajo ilimitado. Especialistas sólo cuando aportan al objetivo.
12. **POS disponible.** Abrir panel bloquea lector/atajos detrás; cerrar, navegar,
    desconectar o reiniciar no debe perder carrito ni encargo guardado. El offline
    actual mantiene su cola y contrato; no construir un segundo motor de ventas.
13. **Finalización honesta.** W01 acepta informe, no cierra caja. Excepciones
    asignadas permanecen visibles; «conciliado» exige explicación verificable de
    todas las diferencias. Hipótesis y proyecciones se identifican como tales.
14. **Recurrencia y mensajes.** Requieren autorización explícita, finalidad, plazo,
    pausa y presupuesto. Un encargo iniciado una vez no autoriza vigilancia ni
    mensajes externos permanentes. No publicar datos privados en avisos.

## RAG, modelos y consumo

15. **Corpus con responsable.** Documento/sección/versión, audiencia, permisos,
    vigencia, fuente y revisión. Borrador/revisado/publicado/retirado son estados
    distintos. Aprobar tres ejemplos no aprueba el artículo completo ni otro hash.
    Sin fuente suficiente, declarar límite y ofrecer el siguiente paso permitido.
16. **No indexar este plan.** Skills, instrucciones de agentes, auditorías,
    conversaciones, facturas y expedientes no son ayuda compartida del negocio.
    Un original privado conserva control de acceso propio; no se sube como imagen
    pública. Versiones retiradas o permisos revocados también afectan historial.
17. **Medir retrieval.** Mantener búsqueda léxica inicial; corpus reservado y
    expected humanos, preguntas sin fuente/contradictorias y aislamiento.
    Embeddings/reranker sólo tras acreditar mejora y costo, con índice reconstruible.
18. **Adaptador de proveedor.** Haiku es la base actual. Cambiar proveedor/modelo
    exige evaluar herramientas, calidad, costos y límites de nuevo. No migrar por
    una novedad comercial ni escalar automáticamente a un modelo más caro.
19. **Una política de gasto.** US$2 iniciales por negocio/mes; aumento solicitado
    por dueño y aprobado por Nortex hasta US$10; US$20 totales en esta etapa.
    Reservar antes de cada llamada, incluyendo contexto, imágenes, salida y
    reintentos. Costo UNKNOWN conserva reserva; atribuir por enlace explícito a la
    operación: run cuando exista, job/extracción/interpretación según su contrato.
    No inventar runs ni usar proximidad temporal. Un tope por DB no prueba control global
    entre QA/staging/producción/canales: autoridad común o cuotas cuya suma respete
    el máximo antes de habilitarlos simultáneamente.
20. **Agotamiento recuperable.** Conservar datos, trabajo y funciones deterministas.
    No cobrar ni aumentar cupo automáticamente. Precio objetivo US$20 del servicio
    y presupuesto US$2 de IA son cifras diferentes.

## Reglas de ingeniería y evidencia

21. **Un editor por dominio/archivo.** Contrato y archivos permitidos antes de
    delegar. Integrador único para schema, migraciones, server, POS, tipos,
    registro de herramientas, dependencias y CI. Revisar no autoriza editar.
22. **Monolito modular.** Flujos nuevos en servicios/rutas/componentes pequeños;
    Prisma compartido por proceso, queries acotadas e índices. Caracterizar antes
    de extraer; reportar origen/destinos/total y reducir presupuesto de origen.
    Nunca elevar límites o excepciones para aprobar una entrega.
23. **Candidato inequívoco.** Registrar base/hash/diff, preservar cambios ajenos,
    rama e índice. Evidencia de un candidato no certifica otro. No reemplazar un
    archivo completo para incorporar una sección documental.
24. **Pruebas proporcionales y reales.** Expected independientes y regresiones del
    producto; compuertas de [AGENTS](../AGENTS.md). Simulación no acredita modelo
    real, un total verde no cubre casos omitidos, lectura estática no es defecto
    reproducido. Un bloqueo de aprobación no se elude con otra herramienta/agente.
25. **Estados separados.** Implementación, QA, revisión humana, modelo, piloto y
    despliegue se reportan por separado. CI/staging deben identificar el mismo
    candidato. Documentar no activa flags, canales, cobros ni despliegues.

## Fuentes documentales y mantenimiento

| Documento | Decide / conserva | Se actualiza cuando |
|---|---|---|
| [Meta](META_NORTEX_EQUIPO_ADMINISTRATIVO.md) | Resultado, usuarios y economía objetivo | Cambia una decisión de producto explícita |
| [Roadmap](ROADMAP_AGENTES_NORTEX.md) | Orden, dependencia y salida de A00–A07/H01 | Cambia prioridad o se acredita una condición |
| [Arquitectura](ARQUITECTURA_AGENTES_NORTEX.md) | Contratos de diseño y límites de implementación | Se acepta una decisión técnica o se concreta el contrato |
| [Estado](ESTADO_ACTUAL_NORTEX.md) | Qué existe y en qué fuente/entorno | Llega evidencia nueva identificable |
| [Equipo](EQUIPO_DESARROLLO_NORTEX.md) | Responsabilidad y coordinación | Se asigna un lote; no presupone procesos permanentes |
| AGENTS / CLAUDE / skills | Método y reglas de ingeniería | Cambia una receta o requisito; reconciliar todos los puntos afectados |
| Informes fechados / manifiestos | Evidencia inmutable de su candidato | Crear nuevo informe; no reescribir resultados anteriores |

Los planes técnicos existentes conservan IDs y detalles; el roadmap concentra
prioridad. Ante discrepancias de estado, verificar código/evidencia y declarar la
incertidumbre. No usar un informe histórico para invalidar una regla vigente ni
usar una regla deseada para afirmar una implementación.

Cada cambio documental indica fecha, alcance y procedencia. Validar enlaces y
coherencia de recetas; no ejecutar pruebas financieras por una edición sólo de
Markdown. La [ficha de trabajo](templates/CONTRATO_TRABAJO_AGENTE.md) obliga a
dejar visibles los campos pendientes, sin inventar revisor, aprobación o evidencia.
