# NortexGPT · contrato de activación inicial

Fecha: 2026-09-23. Candidato aislado desde `dadc81975811850226a6bd7b560a3522068b995a`.
El checkout `codex/caja-nica-retention` y su archivo no rastreado quedan fuera de este lote.

## Resultado y autoridad

- Resultado inicial: ayuda con fuentes aprobadas, consultas deterministas y conversación con Haiku para un negocio piloto identificado, con rol vigente y límite de US$2 por mes. El asistente conserva el trabajo ante fallos y no confirma dinero ni inventario.
- Cierre observable: mismo SHA en CI, staging y producción; worker supervisado con estado verificable; presupuesto, rol y contenido aprobados; recorrido autenticado de datos sintéticos y del piloto con respuesta real, fuente y consumo atribuidos; parada y recuperación probadas.
- Fuera del primer corte: extracción foto/PDF, confirmación de acciones, promociones y WhatsApp privado. Su activación exige almacenamiento privado con backup/restore conjunto, pruebas y aprobación propios.
- Responsable de producto y cuentas propuestas: el dueño designó su cuenta para el primer piloto y la cuenta de 3M Ferretería para un segundo piloto. Confirmó que el responsable de 3M aceptó el piloto y el uso de un modelo externo con límite inicial de US$2 al mes. Los correos quedaron sólo en la conversación de trabajo, no en este repositorio. Antes de cada activación, comprobar el usuario activo, su `tenantId` y rol desde una sesión autenticada o una consulta administrativa controlada; no inferir el negocio por el correo. La aprobación H01 A/B/C no aprueba artículos completos ni expected del modelo.
- Canal: web interna autenticada. Tenant, usuario y rol salen del JWT y se revalidan; el modelo no recibe autoridad de confirmación.
- Efectos: lectura, conversación, estado auxiliar y propuesta. Todo movimiento de dinero/stock sigue en los servicios de dominio con confirmación humana exacta.

## Fuentes y límites

- Las cifras provienen de herramientas de dominio con corte explícito en Managua; la ayuda proviene únicamente de versiones publicadas y vigentes. Mensajes y documentos del usuario son evidencia atribuida.
- Un dato desconocido no se reemplaza con cero. Los artículos D02 pendientes no se publican por habilitar el asistente.
- Un run conserva versión, identidad idempotente, límite de cuatro iteraciones/60 segundos y reserva de gasto antes de llamar al proveedor. Respuesta incierta conserva la reserva.
- Política: US$2 iniciales por negocio/mes, aumento aprobado hasta US$10 y techo conjunto US$20; sin incremento ni cobro automático.
- Retención y recuperación: el worker ejecuta limpieza incluso con capacidades apagadas y debe detenerse físicamente durante restore; conversación, jobs y propuestas vencidos siguen el código vigente. Los originales de compras confirmadas requieren recuperación conjunta antes de habilitar adjuntos.

## Responsabilidad de edición

| Responsable | Archivos permitidos | Contrato |
|---|---|---|
| Codex principal | `docker-compose.yml`, `Dockerfile.backup`, `.github/workflows/ci.yml`, `backend/workers/assistant.ts`, `backend/services/assistant/operations/{workerCycle,workerHeartbeat,healthStatus}.ts`, pruebas correspondientes, `scripts/{assistant-operations-demo.ts,backup-db.sh,backup-scheduler.sh,backup-assistant-originals.sh}`, `scripts/ops/nortexgpt-pilot.ts`, `scripts/qa/{nortexgpt-help-first-cut,seed-assistant-backup-ci,test-nortexgpt-help-release,test-nortexgpt-pilot,verify-assistant-originals-restore}.ts`, `docs/evidence/nortexgpt/{evaluation-20260923/,help-first-cut-20260923/,help-review-20260923.md,originals-joint-restore-20260923.md,pilot-activation-qa-20260923.md}`, `docs/runbooks/{nortexgpt-evaluacion-haiku,nortexgpt-activation-first-cut}.md` y este contrato | Arranque explícito, estado del worker, copia privada opcional, CI, QA, contenido del primer corte, identidad/presupuesto de pilotos y procedimiento del primer corte |

No se delegó edición. `backend/server.ts`, `components/POS.tsx`, schema y flujos monetarios quedan fuera de este lote. Si otro trabajo modifica los archivos anteriores, se reconcilia antes de integrar.

## Compuertas

| Comprobación | Criterio | Estado |
|---|---|---|
| Observación de release existente | 31 muestras durante 30 minutos, SHA y base exactos | Cumplida para el release anterior `dadc819`: 31/31 entre 14:07:05 y 14:37:05 UTC, HTTP 200, `ok`, base arriba, SHA exacto y `no-store`. Evidencia local: `/private/tmp/nortexgpt-activation.fHY9Xs/observation.json` |
| Worker e infraestructura | Misma versión que API, un consumidor, permisos y heartbeat; pausa/reinicio sin duplicar | Parcial en Docker local sintético para `2e6b217`: app y base sanas, worker único arrancó y reinició, la app leyó latido del mismo SHA con permiso 0600. Estado `disabled` esperado con flags apagados. No prueba staging, producción, colas activas ni recuperación de originales |
| SQL y originales | Copia remota coherente y restore aislado con referencias, hashes, permisos, compra y propuesta reconciliados | Parcial: mecanismo opcional de backup SQL + originales permanentes y ensayos locales sintéticos de 143 tablas/228-229 filas; original, compra y propuesta `COMMITTED` reconciliados; alteraciones detectadas. No cubre adjuntos pendientes, copia remota conjunta ni restore de producción; extracción sigue apagada |
| Contenido y expected | Versiones completas y casos revisados por persona | Borrador editorial de diez textos web con hash exacto preparado; dos textos fuera de alcance excluidos del borrador. Revisión humana de textos y expected pendiente |
| Modelo y presupuesto | Llamada sintética real, reserva/settlement y tope comprobados | Pendiente: lanzador con clave sintética aprobado 21/21 en llavero macOS y lote sin revisión rechazado antes de llamada; aún no hay contacto con Haiku ni consumo acreditado |
| Piloto web | Rol real, fuentes, cifras, carrito, revocación y recuperación | Procedimiento de identidad/configuración probado sólo con dos negocios sintéticos; cuentas, recorrido web y presupuesto real pendientes |
| CI, staging y producción | SHA idéntico y smoke por ambiente | Pendiente para este candidato |

La evidencia de cada compuerta conserva escenario, SHA, resultado y límites. Un total de tests no sustituye la prueba operativa ni la aceptación humana.

## Secuencia del piloto

1. Ejecutar primero el recorrido sintético completo: fuentes revisadas, respuesta real del modelo, costo atribuido, revocación, error y conservación del trabajo. Mantener ejecución, adjuntos y envíos apagados.
2. Verificar la identidad y el negocio de la cuenta del dueño; habilitar sólo ayuda, conversación y consultas permitidas con presupuesto inicial de US$2. Comprobar respuesta, cita, período, rol y saldo con esa cuenta; detener la capacidad ante un estado incierto.
3. Verificar la cuenta, negocio y rol de 3M Ferretería y repetir las mismas pruebas y el límite propio de US$2. No usar datos del primer negocio para validar el segundo.
4. Registrar por separado para ambos negocios el SHA, permisos, contenido publicado, configuración, consumo, comprobante de la prueba y resultado humano. Desactivar cada piloto individualmente si falla una compuerta.

## QA local del candidato `2e6b217`

- Compuerta local segura: TypeScript, sistema de diseño y build aprobados; 490 archivos/7082 tests aprobados. Otros 50 archivos/545 tests quedaron omitidos y no cuentan como aprobados. Pruebas dirigidas del worker, latido y estado: 25/25 aprobadas.
- `docker compose config` validó el perfil; sin él, `assistant-worker` no figura entre servicios activos. La imagen del worker construyó con Node 22.23.2 y dependencias de producción; auditoría de dependencias de producción: cero vulnerabilidades reportadas.
- Prueba de integración local: proyecto aislado `nortexgpt-activation-qa`, credenciales sintéticas, Anthropic vacío y asistente global apagado. Tras reiniciar el worker, latido observado desde la app a las 16:00:24 UTC con `state=disabled`, SHA exacto y modo 0600. El proyecto y ambos volúmenes sintéticos se eliminaron al terminar.
- Este QA no realizó una llamada al proveedor, no aceptó artículos de ayuda, no ejecutó una acción de dinero o stock y no habilitó a ningún negocio real.
- El 23 de septiembre se sembró otra base MySQL 8 descartable, se aplicó el primer paso sintético con US$2 por negocio y se generaron los formularios de ferretería y farmacia. La fixture falló al escribir su informe porque `reports/` faltaba en el checkout limpio; se corrigió esa creación y la reejecución idempotente completó los dos negocios. Los formularios permanecen pendientes de revisión humana. Esta fixture sí ejercita servicios de dominio con datos sintéticos antes de deshabilitar acciones para la evaluación.
- Una revisión de la fixture detectó productos creados hoy con ventas fechadas dos semanas atrás. Se corrigió la fecha de alta sintética a 35 días antes, se rehízo una base descartable desde cero y se verificaron 30 días de historial en los seis resultados esperados. Dos ejecuciones de la fixture devolvieron los mismos identificadores de conversación, sin duplicar el montaje.
- Se extrajeron los doce artículos `LEGACY` con su texto, rol y hash en `help-review-20260923.md` para revisión humana. No están aprobados como versiones publicadas; el primer corte propuesto excluye WhatsApp privado y promociones.
- Se añadió un verificador de originales comprados en una base restaurada, con 7 pruebas dirigidas y dos ensayos conjuntos SQL + archivo sintético. El segundo incluyó una propuesta `COMMITTED`, detectó una referencia de compra alterada y volvió a aprobar tras restaurar SQL intacto. La evidencia y los límites están en `originals-joint-restore-20260923.md`.
- Se preparó un backup opcional que verifica y archiva originales permanentes, los sube junto al SQL cuando se habilite y publica el latido sólo tras completar ambas subidas. En QA local, la opción apagada preservó SQL solo; encendida restauró SQL/tar sintéticos y falló cerrada ante tamaño/hash alterado y ante un fallo simulado de publicación del latido. No se usó bucket real.
- El job de CI `backup-restore-smoke` quedó ampliado con un original, compra y propuesta sintéticos, hashes de ambos artefactos y restore conjunto descartable. El fixture se ejecutó en MySQL 8 local; la corrida terminal de CI del candidato sigue pendiente.
- Tras ese cableado, la compuerta local pasó con 491 archivos/7090 pruebas; 50 archivos/545 pruebas omitidas se informan por separado. Diseño y build pasaron. No equivale a CI terminal.
- El recorrido nuevo de CI se reprodujo íntegro en un segundo MySQL 8 local descartable: 143 tablas/6 filas restauradas con conteos iguales, ambos hashes coincidentes y una referencia de propuesta íntegra. GitHub Actions para este SHA sigue pendiente.
- Se añadió `inspect`/`enable`/`disable` para el primer corte individual, con revisor derivado de JWT y AuditLog transaccional. En MySQL 8 local descartable se probaron dos negocios aislados, límite US$2, rechazos de identidad/revisión/sesión, repetición y revocación. Los nuevos pasos de `backup-restore-smoke` aún esperan CI terminal. Ver `pilot-activation-qa-20260923.md`.
- Después de integrar esos pasos en el job existente, la compuerta local completa volvió a pasar: 491 archivos/7090 pruebas; 50 archivos/545 pruebas omitidas por separado, TypeScript, diseño y build. No acredita CI remoto ni cuentas reales.
- El preflight del modelo probó 21/21 controles del lanzador con llavero macOS y credencial sintética; el evaluador rechazó el formulario sin revisión humana antes de una llamada. Ver `evaluation-20260923/launcher-preflight.md`. No se validó una respuesta real ni gasto del proveedor.
- Se generó `help-first-cut-20260923/` como propuesta editorial de diez versiones web, hash `f3fd57932a02205f49fd93fa957346b6a71c1705b0001114d44ff3bfe1ea1cfb`; promociones y canal privado quedaron fuera de la propuesta y de los canales de cada texto. Los cuerpos provienen del corpus `LEGACY` pero la versión editorial nueva sólo permite `WEB_INTERNAL`. No se publicó nada ni se aprobó el contenido.
- Ese archivo exacto pasó el ciclo editorial en MySQL 8 local descartable: rechazo de publicación sin revisión, diez fuentes nuevas activas tras revisión **simulada**, dos excluidas y repetición sin duplicados. Los pasos están añadidos a `backup-restore-smoke`; falta CI remoto y revisión humana real.
- El CLI de activación ahora rechaza `LEGACY`, `DRAFT` y `REVIEWED`; sólo acepta la publicación activa del primer corte con hash exacto y revisión registrada. MySQL 8 descartable confirmó rechazo sin cambios y activación de dos negocios tras publicación **simulada**. La prueba editorial usa otra base para conservar el escenario desde `LEGACY`. No se publicó contenido ni se activó un negocio real.
- La revisión editorial detectó que las diez copias `LEGACY` aún ofrecían el canal privado. El borrador se regeneró como versiones `2026-09-23.web1` con `WEB_INTERNAL` exclusivo y hash `f3fd57932a02205f49fd93fa957346b6a71c1705b0001114d44ff3bfe1ea1cfb`. La hoja de revisión reproduce textos, roles y hashes exactos; MySQL QA confirmó que las consultas por canal privado no hallan citas nuevas. La aprobación humana sigue pendiente.
- Los formularios de evaluación sintética prueban `operations=true`, mientras que el piloto inicial configura `operationsEnabled=false`. Esa evaluación no sustituye el smoke con flags efectivos de los dos negocios; una eventual activación de operaciones necesita su propia aprobación y medición de gasto.
