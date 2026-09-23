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
   y sus hashes. Los textos `LEGACY` no equivalen a publicación aprobada. Registrar
   la política de US$2 iniciales y techo conjunto US$20 antes de una llamada.
2. Promover el nuevo SHA por staging y producción manuales, con sus smokes. Arrancar
   un solo worker después de verificar schema, volumen y colas. Repetir el estado
   autenticado y observar recursos, errores, cola y presupuesto.
3. Habilitar únicamente los flags globales y la configuración del negocio para el
   recorrido aceptado. `LANGUAGE` permite llamadas del chat; `OPERATIONS` puede
   llamar al modelo aun con `LANGUAGE` apagado. Probar cada una por separado.
4. Ante error o estado incierto, apagar la capacidad del negocio y el flag global,
   conservar identidad/reserva y consultar el comprobante. Detener físicamente el
   worker antes de cualquier recuperación. No repetir webhooks, escrituras ni
   llamadas pagadas por una respuesta perdida.

## Siguientes capacidades

Foto/PDF exige copia y restauración conjunta de MySQL y originales privados,
permisos y hashes conciliados, un ensayo de reinicio con lease, evaluación por
vertical y confirmación humana exacta. WhatsApp privado exige su propio worker,
canal vinculado y pruebas de UNKNOWN; esta configuración no lo inicia.

Después de restaurar una copia conjunta en un MySQL 8 descartable y un directorio
privado, ejecutar `scripts/qa/verify-assistant-originals-restore.ts` con
`RESTORE_DATABASE_URL` y `NORTEX_ASSISTANT_STORAGE_DIR` apuntando sólo a esos
destinos. Exigir `status=ok`, comprobados positivos y cero diferencias. El
[ensayo sintético local](../evidence/nortexgpt/originals-joint-restore-20260923.md)
prueba el verificador, pero no sustituye la copia off-site de producción.
