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
| Pruebas unitarias | 6/6: copia íntegra, ausencia, alteración, permisos/symlink, compra inválida/duplicados, conjunto vacío y guard del URL de restore |

El verificador está en `scripts/qa/verify-assistant-originals-restore.ts`. Requiere
`RESTORE_DATABASE_URL` con nombre descartable y `NORTEX_ASSISTANT_STORAGE_DIR`
absoluto y privado, ambos apuntando al mismo ensayo restaurado. No muestra
identificadores de negocio, nombres de archivo ni bytes. Una base sin compras
con originales devuelve `empty`, no una recuperación acreditada.

Este ensayo **no** acredita la copia off-site de los originales ni una
restauración de datos de producción. `backup-db.sh` sigue copiando sólo SQL;
el tar de este ensayo se creó manualmente. Antes de habilitar foto/PDF se
necesita un mecanismo programado que copie SQL y originales al destino privado,
un manifiesto coherente y un restore drill de esa copia remota. Extracción y
ejecución permanecen apagadas.
