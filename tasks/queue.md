# Plantilla de Tarea para el Agente Headless

Copiá esta plantilla a `tasks/current.md`, completá cada campo y luego ejecutá
`scripts/run-task-headless.sh`. El script lee `ID_TAREA` para nombrar la rama
(`agent/task-<ID_TAREA>`) y pasa el contenido completo del archivo a Claude Code
como instrucción de ejecución.

> Reglá de parseo: el campo `ID_TAREA:` debe estar en una sola línea y sin
> espacios en el valor (ej: `001`, `fix-login`, `AUTH-12`).

---

## ID_TAREA
ID_TAREA:

## TÍTULO
<!-- Resumen en una sola línea de lo que hay que lograr. -->

## CONTEXTO_TÉCNICO
<!-- Background técnico: módulos involucrados, decisiones previas, restricciones,
     enlaces a documentación interna. Cuanto más preciso, mejor el resultado. -->

## ARCHIVOS_AFECTADOS
<!-- Lista de archivos/directorios que se espera tocar. Si la tarea NO debería
     tocar cierto código (ej: lógica de negocio activa), indicarlo aquí. -->

## CRITERIOS_DE_ACEPTACIÓN
<!-- Condiciones verificables y objetivas que definen "terminado". -->

## TESTS_OBLIGATORIOS
<!-- Tests que deben pasar antes de dar la tarea por completada.

     IMPORTANTE: si la tarea toca la base de datos (queries, migraciones,
     modelos Prisma, repositorios, etc.) es OBLIGATORIO incluir validación de
     AISLAMIENTO MULTI-TENANT:
       - Cada tenant solo puede leer y modificar sus propios registros.
       - Ninguna query puede devolver ni alterar datos de otro tenant.
       - Probar explícitamente el caso negativo: un tenant intentando acceder a
         datos de otro tenant debe fallar / devolver vacío. -->
