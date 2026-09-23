# Propuesta editorial del primer corte web

Fecha: 2026-09-23. **Borrador sin revisión humana ni publicación.**

[`release-draft.json`](release-draft.json) tiene la forma exacta que acepta
`POST /api/admin/assistant-knowledge/releases`; [`manifest-draft.json`](manifest-draft.json)
fija las referencias de las mismas diez versiones. Hash del manifiesto:
`3fd9d35629941def01964763fedf55981bac7075f4f4bcb17ccb8d9137ce6404`.
Los cuerpos son copias exactas del corpus `LEGACY` del candidato, sin declarar
que su contenido sea correcto. No se hizo POST, revisión ni publicación.

| Propuestos para revisión | Motivo de atención |
|---|---|
| asistente, ventas, offline, compras, lotes, contabilidad, reposicion, comparacion | Ayuda y lectura pertinentes al primer corte; comprobar texto, roles y recorrido real |
| salida-proveedor, merma | Describen confirmaciones fuera del asistente inicial; revisar que el texto no sugiera que el chat puede ejecutarlas |

`promociones` y `canal-privado` quedan **fuera de este borrador** porque el
primer corte mantiene esas capacidades apagadas. El corpus `LEGACY` actual
puede mostrarlos hasta que se publique un manifiesto revisado; preparar este
archivo no cambia la ayuda que ven los usuarios. Tras publicar, las consultas
nuevas usan sólo las referencias activas, pero las referencias históricas
tienen su propio contrato de acceso y retirada.

Para verificar que los archivos aún coinciden con el código fuente:

```sh
mise exec -- node --import tsx scripts/qa/nortexgpt-help-first-cut.ts --verify
```

Antes de solicitar revisión o publicación, una persona debe revisar **cada
texto completo** en [`help-review-20260923.md`](../help-review-20260923.md),
comprobar roles/canales y corregir los que no describan el producto vigente.
Una corrección requiere versión nueva y nuevo hash: la versión `LEGACY` es
inmutable. El revisor y su aprobación no están registrados aquí.

## Ensayo técnico del archivo exacto

En un MySQL 8 local descartable, `test-nortexgpt-help-release.ts` cargó este
`release-draft.json` y comprobó el hash indicado. `stage` dejó activa la ayuda
LEGACY; `publish` sin `review` fue rechazado. Tras **simular** la transición de
revisión con usuarios sintéticos, la publicación dejó diez fuentes activas,
excluyó promociones y canal privado de consultas nuevas, sirvió una cita
`PUBLISHED`, conservó una sola generación al repetir y dejó tres AuditLog.
La simulación acredita la mecánica editorial, **no** la revisión de los textos
por una persona. El mismo ensayo quedó añadido al job MySQL de CI, aún sin
corrida remota para este candidato. La base sintética se retiró al terminar.
En una segunda base descartable se reprodujo además el orden exacto de esos
pasos de CI: ensayo de dos pilotos primero y ensayo editorial después; ambos
aprobaron en la misma base. No se usaron negocios ni cuentas reales.
La compuerta local segura posterior pasó con Prisma, TypeScript, Vitest,
sistema de diseño y build. GitHub Actions sigue pendiente para este SHA.
