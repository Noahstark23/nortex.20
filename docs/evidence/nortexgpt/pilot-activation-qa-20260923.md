# NortexGPT · ensayo de activación individual de pilotos

Fecha: 2026-09-23. Sólo MySQL 8 local descartable y dos negocios sintéticos.
No se consultaron ni modificaron cuentas reales, ni se llamó a un modelo.

El procedimiento `scripts/ops/nortexgpt-pilot.ts` separa `inspect` (lectura)
de `enable` y `disable` (cambio auditado). Para cambiar exige usuario,
negocio, correo y rol coincidentes; revisor de otro negocio derivado de un
JWT firmado y revalidado como `SUPER_ADMIN` activo; motivo; revisión declarada
del contenido; y confirmación tipada. `enable` también verifica que la versión
exacta del primer corte ya esté publicada con revisión registrada; no acepta
`LEGACY`, `DRAFT` ni `REVIEWED`. La configuración inicial fija ambos
campos de presupuesto en US$2 y mantiene apagadas operaciones, extracción,
ejecución, acciones, promociones y WhatsApp privado. El estado global de
Coolify sigue siendo una compuerta separada que este script no verifica.

El ensayo `scripts/qa/test-nortexgpt-pilot.ts` aplicó el schema actual y
ejecutó el CLI real con dos negocios, dos usuarios OWNER y un revisor sintético.

| Escenario | Resultado observado |
|---|---|
| Vista previa | Identidad, negocio, rol, estado y configuración sin escritura |
| Revisión faltante, token inválido, dueño como revisor, usuario o revisor inactivo, identidad distinta | Rechazados sin crear configuración |
| Ayuda `LEGACY`, borrador y versión sólo revisada | `PILOT_HELP_RELEASE_REQUIRED`; no se creó configuración |
| Primera activación | Límite efectivo US$2, seis capacidades sensibles apagadas y AuditLog del revisor en la misma transacción |
| Recorrido con flags del primer corte | Ayuda web publicada con cita `ventas`, consulta de inventario determinista, cero `AssistantRun` y cero `AssistantUsage` |
| Repetición | `changed=false` y sin segundo AuditLog |
| Segundo negocio | Configuración propia de US$2 y conversación propia; revocar el primero no cambió el segundo |
| Revocación y repetición | `enabled=false`, un AuditLog de revocación, se rechazan conversación nueva y mensaje en la abierta, sin duplicar auditoría al repetir |
| Capacidad previa encendida | Nueva activación rechazada sin sobrescribirla |

TypeScript aprobó. Los pasos del job `backup-restore-smoke` están cableados en CI,
pero aún no se ha ejecutado en GitHub Actions para este candidato. El ensayo
no demuestra la identidad ni el rol de las dos cuentas reales, revisión
humana, proveedor, costo real, staging ni producción. Esas compuertas siguen
pendientes antes de ejecutar `enable` para el dueño y luego para 3M.

Después se repitió el ensayo contra MySQL 8 descartable con el guard editorial:
el CLI rechazó tres estados previos a publicación y aceptó el hash exacto tras
una revisión **simulada**. Dos negocios conservaron presupuesto y revocación
independientes. La prueba editorial pasó en otra base descartable. CI remoto
para este cambio sigue pendiente; la revisión simulada no aprueba textos reales.
La compuerta local posterior pasó con Prisma generate, TypeScript, 491 archivos
y 7090 pruebas; 50 archivos y 545 pruebas quedaron omitidos. Diseño y build
pasaron. Tras añadir `helpReleaseReady` a `inspect`, se repitió el CLI contra
una tercera base MySQL 8 descartable y pasó; TypeScript y `git diff --check`
también aprobaron. Ninguna de estas pruebas equivale a CI remoto.

Un ensayo posterior en otra base descartable ejercitó el recorrido exacto del
primer corte con `LANGUAGE=false` y `OPERATIONS=false`: la cuenta OWNER obtuvo
una cita de ayuda web publicada y una consulta de inventario determinista.
No se creó `AssistantRun` ni `AssistantUsage`. El segundo negocio mantuvo su
conversación y citas propias tras revocar el primero; la cuenta revocada no pudo
crear ni continuar conversación. No se llamó al proveedor ni se tocaron cuentas
reales, dinero o inventario de usuarios.

Tras integrar los pasos en el job MySQL existente, la compuerta local completa
pasó: 491 archivos y 7090 pruebas aprobadas; 50 archivos y 545 pruebas
omitidas se cuentan aparte. TypeScript, diseño y build pasaron. El primer
intento había fallado por añadir un cuarto job con `setup-node`, contrario al
guard del workflow; se reutilizó el job existente y su prueba dirigida volvió
a aprobar. El contenedor MySQL sintético se retiró al cerrar el ensayo.
