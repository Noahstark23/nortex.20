# NortexGPT · ensayo local de restauración SQL + originales

Fecha: 2026-09-23. Escenario exclusivamente sintético, sin negocio real ni
objeto remoto. La imagen de `Dockerfile.backup` ejecutó `backup-db.sh` con
`BACKUP_LOCAL_ONLY=1` contra MySQL 8 descartable. El origen quedó congelado
durante la copia.

| Comprobación | Resultado observado |
|---|---|
| Backup SQL | 143 tablas, 44.142 bytes comprimidos; hash SHA-256 del archivo coincidió con `last-backup.json` |
| Restore SQL | `verify-backup-restore.sh` importó 143 tablas y 228 filas en `nortex_restore_test`; conteos idénticos al origen |
| Original sintético | Un PDF opaco, vinculado a una compra de la ferretería sintética; directorio 0700 y archivo 0600 |
| Copia y restore del original | Archivo archivado por separado, extraído en otro directorio privado; archivo tar de 6.656 bytes, hash abreviado `aae1c58876fc` |
| Reconciliación | El verificador leyó la base restaurada y obtuvo `ok`, 1 comprobado, 0 ausentes/alterados, compra y tenant concordantes |
| Control negativo | Tras alterar el archivo restaurado devolvió código 2 y `altered=1`; al extraer de nuevo la copia intacta volvió a `ok` |
| Pruebas unitarias | 7/7: copia íntegra, ausencia, alteración, permisos/symlink, compra inválida/duplicados, conjunto vacío, guard del URL de restore y referencias de propuestas confirmadas |

Un segundo montaje sintético añadió una propuesta `COMMITTED` que referencia
el mismo original y compra. `backup-db.sh` produjo 143 tablas y 44.210 bytes
comprimidos, con SHA-256 coincidente con su latido; el restore importó 143
tablas/229 filas con conteos idénticos. El tar privado midió 6.656 bytes y
tuvo hash abreviado `e2e303467e7a`. El verificador devolvió `ok`, un original
y una referencia de propuesta comprobados, sin diferencias. Al cambiar sólo el
`purchaseId` del resultado de la propuesta en la base restaurada devolvió
código 2 y `brokenProposalReferences=1`. Restaurar de nuevo el SQL intacto
devolvió `ok` y cero referencias rotas.

El verificador está en `scripts/qa/verify-assistant-originals-restore.ts`. Requiere
`RESTORE_DATABASE_URL` con nombre descartable y `NORTEX_ASSISTANT_STORAGE_DIR`
absoluto y privado, ambos apuntando al mismo ensayo restaurado. No muestra
identificadores de negocio, nombres de archivo ni bytes. Una base sin compras
con originales devuelve `empty`, no una recuperación acreditada.
También contrasta las referencias de propuestas `COMMITTED` con adjunto,
compra, usuario y negocio. El primer montaje creó el original ligado
directamente a una compra; el segundo probó además la propuesta confirmada.
Ambas filas de QA fueron sembradas para probar recuperación, no resultaron de
un flujo real de foto/PDF y confirmación.

Esos dos primeros ensayos **no** acreditaron la copia off-site de los
originales ni una restauración de datos de producción: el tar se creó
manualmente y `backup-db.sh` aún copiaba sólo SQL. El mecanismo opcional
añadido después se ensayó por separado a continuación. Extracción y ejecución
permanecen apagadas.

## Ensayo del mecanismo programable opcional

El mismo día se añadió `backup-assistant-originals.sh`, llamado por
`backup-db.sh` sólo con `BACKUP_ASSISTANT_ORIGINALS_ENABLED=true`. La imagen
de backup del candidato compiló y el Compose validó. Contra otro MySQL 8
descartable se observaron estos casos:

| Caso | Resultado |
|---|---|
| Opción apagada | Backup SQL de 143 tablas aprobado; sin tar ni campo `assistantOriginals` en el latido |
| Opción encendida, `BACKUP_LOCAL_ONLY=1` | SQL de 143 tablas/44.232 bytes y tar privado de 10.240 bytes con un original; ambos hashes coincidieron con el latido y el tar quedó 0600 |
| Restore de esos artefactos | SQL de 143 tablas/229 filas con conteos iguales al origen; original, compra y propuesta `COMMITTED` conciliados, sin diferencias |
| Original sintético truncado | Backup falló, sin tar ni latido nuevo |
| Original sintético de igual tamaño pero otro hash | Backup falló, sin tar ni latido nuevo |
| Subida del latido simulada como fallida | Un comando AWS falso aceptó el dump y rechazó `last-backup.json`; no hubo latido local nuevo ni conexión real al bucket |

El nuevo tar contiene sólo originales vinculados a compras; una foto todavía
pendiente de confirmación no queda cubierta por esta copia. Por eso esta prueba
acerca la recuperación de comprobantes permanentes, pero **no habilita aún
foto/PDF** ni acredita el respaldo remoto. Antes de activarlo hay que definir
y comprobar la recuperación de adjuntos pendientes, ejecutar el backup real
off-site y restaurar su par SQL/tar desde el objeto remoto.

El candidato también añade al job `backup-restore-smoke` de CI un fixture
descartable con original `ATTACHED`, compra y propuesta `COMMITTED`; el job
archiva SQL y original, comprueba ambos hashes del latido, restaura en otra
base/directorio privados y exige una referencia de propuesta íntegra. El
fixture se ejecutó localmente contra MySQL 8 descartable y TypeScript pasó.
**El job de CI todavía no ha corrido para este SHA**, por lo que este cableado
no es evidencia de un resultado terminal remoto.
La compuerta local integral pasó después del cableado: 491 archivos y 7090
pruebas aprobadas; 50 archivos y 545 pruebas omitidas se contabilizan aparte.
También pasaron diseño y build. La base, el contenedor y los originales
sintéticos de este ensayo se retiraron al terminar.
