# Reinicio de cuentas de prueba e importación asistida

Una carga inicial equivocada puede dejar productos y ventas de prueba que no deben mezclarse con la operación real. El dueño de una cuenta TRIAL sin cobros puede reiniciarla desde Mi Plan; SUPER_ADMIN puede asistir también a una cuenta ACTIVE activada manualmente sin pago.

El servidor exige dueño exacto, contraseña del actor, declaración de datos de prueba y revisión vigente. Pagos pendientes/aprobados, Stripe y compromisos de plataforma bloquean. Confirmar archiva el espacio anterior, revoca usuarios/invitaciones/flota/canal WhatsApp y crea uno limpio conservando correo/contraseña del dueño, configuración, permiso de presupuesto y fechas de acceso. No elimina documentos ni renueva el plazo ni el presupuesto de IA. No hay restauración del archivo desde la interfaz.

El comprobante administrativo permite importar durante 24 horas exclusivamente en el espacio creado por ese administrador. El importador existente registra cada producto, stock, Kardex, auditoría y comprobante en una transacción. Repetir un SKU idéntico no suma existencias; contenido distinto se rechaza. El destino y el actor provienen de la sesión y del comprobante, nunca del Excel. No se emiten sesiones del dueño.

## Evidencia y publicación

Candidato integrado sobre main `86549b5196417d7461bf9011f4df6c259a8200f7`; se preservaron la política actual del presupuesto y el importador con filtros. TypeScript, diseño (137 archivos), build/SEO y 7,512 pruebas unitarias pasaron; las suites HTTP/MySQL se verifican separadamente con base descartable. Reinicio del dueño: 20 casos; asistencia administrativa: 15 casos. Las integraciones omitidas por el runner unitario no se cuentan como aprobadas por ese runner.

El recorrido previo en navegador local confirmó 166 productos, sus cantidades/precios/costos y repetición sin duplicar. Ese resultado no acredita ejecución en la cuenta real ni en el SHA publicado. CI ejecuta además la imagen y el arranque real con los contratos actualizados; staging y producción requieren evidencia propia.

## Expansión aditiva y recuperación

Dos migraciones: `202610090001_demo_account_reset` y `202610090002_admin_demo_reset`. Agregan dos tablas, dos campos de Tenant e índices. No borran ni cambian tipos existentes. Cliente generado: 155 modelos y 1,876 campos escalares.

Se reprodujeron los baselines exactos en MySQL 8 descartable. Fingerprint posterior:

- staging: `dfd635e19c80bcea735d14d6a0165c68e417c42c07381c1dfcbb53025f5eb32c`.
- producción: `9e3d8dc319e441e53c40844f11faabdf5bad3af718109697be03b7f8a361336f`.

El ensayo de CI rechaza cada esquema anterior sin mutarlo y aplica los SQL con hashes verificados únicamente en la base sintética. El launcher remoto mantiene su gate de solo lectura: la expansión debe ejecutarse como intervención controlada, con respaldo off-site restaurable y evidencia del antes/después. Un rollback conserva el esquema expandido y requiere una imagen anterior con contrato compatible ensayado; no volver a ejecutar un entrypoint histórico ni retirar tablas.

## Catálogo inicial

Para cantidades como 80.34 lb, el catálogo corregido usa MEASURED y paso 0.01; redondear a 0.25 alteraría inventario. La carga asistida fuerza existencias iniciales y bodega. La carga normal de catálogo conserva su comportamiento: no sustituye existencias de códigos ya creados.
