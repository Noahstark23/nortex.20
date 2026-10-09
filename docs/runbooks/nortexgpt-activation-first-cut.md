# NortexGPT · primer corte operativo

Este procedimiento habilita conversación web y consultas para un piloto acotado.
No habilita extracción, confirmación de compras, promociones ni WhatsApp privado.
Usar el SHA candidato de la entrega, nunca copiar el de este documento como destino.

## Antes de iniciar el worker

1. Confirmar CI terminal, staging y producción del mismo SHA según
   [release-promotion](release-promotion.md). Registrar backup SQL off-site vigente y
   restore aislado; contar jobs, adjuntos y runs pendientes antes de arrancar.
2. Verificar en Coolify que el Compose efectivo usa este archivo y que la API y el
   worker salen del mismo checkout. El servicio `assistant-worker` está bajo el
   perfil `assistant-worker`: un `up` normal no lo arranca. Staging y producción
   deben tener volúmenes `assistant_private` distintos. Ninguno publica puertos.
3. Confirmar `SOURCE_COMMIT` completo y exacto en el worker, la misma base que la
   API y el montaje de `/var/lib/nortex/assistant` compartido. El subdirectorio
   `originals` debe ser 0700 y su latido 0600; el estado administrativo falla
   cerrado ante un SHA distinto, latido vencido o ruta ausente.
4. Dejar `NORTEX_ASSISTANT_EXTRACTION_ENABLED`, `NORTEX_ASSISTANT_EXECUTION_ENABLED`,
   `NORTEX_ASSISTANT_ACTIONS_ENABLED`, `NORTEX_PROMOTIONS_ENABLED`,
   `NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED` y envíos privados en `false`.
   No arrancar el worker como sonda durante un restore: ejecuta limpieza incluso
   con las capacidades apagadas.

## Staging sintético

1. Encender el perfil únicamente en staging tras comprobar API/base/SHA. Usar un
   solo `assistant-worker`; comprobar imagen/versión, reinicio, logs saneados y
   `/api/assistant/status` con cuenta administradora sintética. `worker.status=ok`
   requiere un latido reciente del mismo SHA; un contenedor `running` no basta.
2. Ensayar parada, reinicio y 30 minutos de observación. Con extracción apagada,
   un job sintético pendiente no debe ser reclamado. Con operaciones apagadas,
   un run pendiente tampoco. Comprobar retención y que no hay doble consumidor.
3. Preparar y revisar los expected con una persona. Ejecutar la evaluación Haiku
   con datos sintéticos, archivo de revisión firmado y presupuesto de US$2 por
   negocio. Registrar respuesta real, fuente, reserva, liquidación y fallos.
4. Recorrer ayuda, consulta de cifra, pregunta sin fuente, rol sin permiso,
   revocación y desconexión. El POS conserva carrito y atajos bajo el panel.

## Activación del piloto

1. Identificar negocio, cuenta, rol y revisor humano; revisar artículos completos
   y sus hashes en la [hoja del primer corte](../evidence/nortexgpt/help-first-cut-20260923/review-sheet.md).
   Los textos `LEGACY` no equivalen a publicación aprobada. Registrar
   la política de US$2 iniciales y techo conjunto US$20 antes de una llamada.
   `scripts/ops/nortexgpt-pilot.ts inspect` consulta por
   `NORTEX_PILOT_EMAIL` sin modificar datos y devuelve `userId`, `tenantId`,
   negocio, rol, estado, configuración efectiva y `helpReleaseReady`. Exigir
   `helpReleaseReady=true` antes de habilitar. Ejecutarlo por separado para
   la cuenta del dueño y la de 3M; comprobar la correspondencia con el
   responsable antes de continuar. No guardar correos ni credenciales en Git.
2. Promover el nuevo SHA por staging y producción manuales, con sus smokes. Arrancar
   un solo worker después de verificar schema, volumen y colas. Repetir el estado
   autenticado y observar recursos, errores, cola y presupuesto.
3. Habilitar únicamente los flags globales y la configuración del negocio para el
   recorrido aceptado. `LANGUAGE` permite llamadas del chat; `OPERATIONS` puede
   llamar al modelo aun con `LANGUAGE` apagado. Probar cada una por separado.
   Para la configuración puntual, `scripts/ops/nortexgpt-pilot.ts enable`
   exige correo, `tenantId`, `userId` y rol exactos obtenidos en `inspect`,
   el JWT vigente de un SUPER_ADMIN activo de otro negocio, motivo, revisión
   humana de contenido y expected, y confirmación tipada en variables
   `NORTEX_PILOT_*`. El revisor sale del JWT verificado y se revalida bajo
   transacción; no se acepta un ID de revisor proporcionado por el operador. Fija el
   límite efectivo en US$2 y deja apagadas operaciones, acciones, extracción,
   ejecución, promociones y WhatsApp. Audita el cambio en la misma transacción.
   El mismo cambio exige que `nortexgpt-primer-corte-20260923` esté publicado,
   con revisión humana registrada y el hash exacto
   `debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c`.
   Rechaza el corpus `LEGACY`, un borrador o una versión sólo revisada. Si una
   corrección editorial cambia el hash, actualizar el guard y repetir su QA antes
   de activar; no reutilizar una confirmación sobre contenido distinto.
   No ejecutar `enable` hasta que CI, staging, producción y revisión estén
   aprobados; este script no despliega ni valida flags de Coolify.
   Para `enable` se exigen `NORTEX_PILOT_EMAIL`, `NORTEX_PILOT_TENANT_ID`,
   `NORTEX_PILOT_USER_ID`, `NORTEX_PILOT_EXPECTED_ROLE`,
   `NORTEX_PILOT_ADMIN_JWT`, `NORTEX_PILOT_REASON`,
   `NORTEX_PILOT_CHANGE_ACK=explicit-pilot-change`,
   `NORTEX_PILOT_REVIEW_ACK=content-and-expected-reviewed` y
   `NORTEX_PILOT_CONFIRM=enable:<tenantId>:<userId>:<rol>:USD2`.
   Pasar el JWT y el keyring mediante un entorno privado; no incluirlos en
   argumentos, archivos de Git, logs ni respuestas del agente.
4. Ante error o estado incierto, apagar la capacidad del negocio y el flag global,
   conservar identidad/reserva y consultar el comprobante. Detener físicamente el
   worker antes de cualquier recuperación. No repetir webhooks, escrituras ni
   llamadas pagadas por una respuesta perdida.
   `scripts/ops/nortexgpt-pilot.ts disable` requiere la misma identidad,
   autoridad independiente y confirmación tipada; desactiva sólo el negocio y
   deja un AuditLog. Comprobar después que la sesión ya no obtiene capacidades.

## Siguientes capacidades

Foto/PDF exige copia y restauración conjunta de MySQL y originales privados,
permisos y hashes conciliados, un ensayo de reinicio con lease, evaluación por
vertical y confirmación humana exacta. WhatsApp privado exige su propio worker,
canal vinculado y pruebas de UNKNOWN; esta configuración no lo inicia.

La copia programable de originales permanentes está detrás de
`BACKUP_ASSISTANT_ORIGINALS_ENABLED=false` por defecto. Habilitarla exige
montaje privado de solo lectura en `backup`, bucket privado y restauración
verificada del par SQL/tar desde ese bucket. El tar actual incluye adjuntos
vinculados a compras, no capturas pendientes; la recuperación de esas capturas
debe resolverse antes de encender extracción.

Después de restaurar una copia conjunta en un MySQL 8 descartable y un directorio
privado, ejecutar `scripts/qa/verify-assistant-originals-restore.ts` con
`RESTORE_DATABASE_URL` y `NORTEX_ASSISTANT_STORAGE_DIR` apuntando sólo a esos
destinos. Exigir `status=ok`, comprobados positivos y cero diferencias. El
[ensayo sintético local](../evidence/nortexgpt/originals-joint-restore-20260923.md)
prueba el verificador, pero no sustituye la copia off-site de producción.
