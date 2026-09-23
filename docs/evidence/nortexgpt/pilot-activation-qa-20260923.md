# NortexGPT · ensayo de activación individual de pilotos

Fecha: 2026-09-23. Sólo MySQL 8 local descartable y dos negocios sintéticos.
No se consultaron ni modificaron cuentas reales, ni se llamó a un modelo.

El procedimiento `scripts/ops/nortexgpt-pilot.ts` separa `inspect` (lectura)
de `enable` y `disable` (cambio auditado). Para cambiar exige usuario,
negocio, correo y rol coincidentes; revisor de otro negocio derivado de un
JWT firmado y revalidado como `SUPER_ADMIN` activo; motivo; revisión declarada
del contenido; y confirmación tipada. La configuración inicial fija ambos
campos de presupuesto en US$2 y mantiene apagadas operaciones, extracción,
ejecución, acciones, promociones y WhatsApp privado. El estado global de
Coolify y el contenido publicado son compuertas separadas.

El ensayo `scripts/qa/test-nortexgpt-pilot.ts` aplicó el schema actual y
ejecutó el CLI real con dos negocios, dos usuarios OWNER y un revisor sintético.

| Escenario | Resultado observado |
|---|---|
| Vista previa | Identidad, negocio, rol, estado y configuración sin escritura |
| Revisión faltante, token inválido, dueño como revisor, usuario o revisor inactivo, identidad distinta | Rechazados sin crear configuración |
| Primera activación | Límite efectivo US$2, seis capacidades sensibles apagadas y AuditLog del revisor en la misma transacción |
| Repetición | `changed=false` y sin segundo AuditLog |
| Segundo negocio | Configuración propia de US$2; revocar el primero no cambió el segundo |
| Revocación y repetición | `enabled=false`, un AuditLog de revocación y sin duplicarlo al repetir |
| Capacidad previa encendida | Nueva activación rechazada sin sobrescribirla |

TypeScript aprobó. Los pasos del job `backup-restore-smoke` están cableados en CI,
pero aún no se ha ejecutado en GitHub Actions para este candidato. El ensayo
no demuestra la identidad ni el rol de las dos cuentas reales, revisión
humana, proveedor, costo real, staging ni producción. Esas compuertas siguen
pendientes antes de ejecutar `enable` para el dueño y luego para 3M.

Tras integrar los pasos en el job MySQL existente, la compuerta local completa
pasó: 491 archivos y 7090 pruebas aprobadas; 50 archivos y 545 pruebas
omitidas se cuentan aparte. TypeScript, diseño y build pasaron. El primer
intento había fallado por añadir un cuarto job con `setup-node`, contrario al
guard del workflow; se reutilizó el job existente y su prueba dirigida volvió
a aprobar. El contenedor MySQL sintético se retiró al cerrar el ensayo.
