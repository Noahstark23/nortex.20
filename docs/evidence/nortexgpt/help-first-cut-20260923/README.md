# Propuesta editorial del primer corte web

Fecha: 2026-09-23. **Borrador sin revisión humana ni publicación.**

[`release-draft.json`](release-draft.json) tiene la forma exacta que acepta
`POST /api/admin/assistant-knowledge/releases`; [`manifest-draft.json`](manifest-draft.json)
fija las referencias de las mismas diez versiones. Hash del manifiesto:
`3d18a116746db968c3e808daf406c1edb70350f706e8111752f80673907f1126`.
Ocho cuerpos provienen del corpus `LEGACY` del candidato; `reposicion` y
`comparacion` se corrigieron para no prometer consultas operativas apagadas en
este piloto. Ocho artículos usan `2026-09-23.web1` y esos dos usan
`2026-09-23.web2`. Todos permiten sólo `WEB_INTERNAL`; ninguna de las diez versiones
autoriza `WHATSAPP_PRIVATE`. No se hizo POST, revisión ni publicación.

| Propuestos para revisión | Motivo de atención |
|---|---|
| asistente, ventas, offline, compras, lotes, contabilidad | Ayuda y lectura pertinentes al primer corte; comprobar texto, roles y recorrido real |
| reposicion, comparacion | Textos corregidos: explicar que las consultas operativas del asistente siguen apagadas en este piloto |
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
versión propuesta y su hash** en [`review-sheet.md`](review-sheet.md),
comprobar roles/canales y corregir los que no describan el producto vigente.
[`help-review-20260923.md`](../help-review-20260923.md) conserva las doce fuentes
`LEGACY` de origen para comparación; no es el manifiesto por aprobar.
Una corrección requiere otra versión y otro hash. El revisor y su aprobación
no están registrados aquí.

## Ensayo técnico del archivo exacto

En un MySQL 8 local descartable, `test-nortexgpt-help-release.ts` cargó este
`release-draft.json` y comprobó el hash indicado. `stage` dejó activa la ayuda
LEGACY; `publish` sin `review` fue rechazado. Tras **simular** la transición de
revisión con usuarios sintéticos, la publicación dejó diez fuentes activas,
excluyó promociones y canal privado de consultas nuevas, sirvió una cita
`PUBLISHED`, conservó una sola generación al repetir y dejó tres AuditLog.
También se comprobó que, aun encendiendo la capacidad privada en la base QA,
la consulta de los artículos nuevos por `WHATSAPP_PRIVATE` no devuelve citas.
La simulación acredita la mecánica editorial, **no** la revisión de los textos
por una persona. El mismo ensayo quedó añadido al job MySQL de CI. Se repitió
para el hash actual en una base sintética independiente y aprobó; la base se
retiró al terminar.
Otra base sintética confirmó que «¿Cómo comparar ventas?» y «¿Cómo reponer
productos?» citan los dos textos corregidos, explican que esas consultas aún
no están habilitadas y no crean `AssistantRun`.
En una segunda base descartable se reprodujo el orden anterior de CI: ensayo
de dos pilotos primero y ensayo editorial después; ambos aprobaron. El guard
nuevo del piloto exige publicación previa, así que CI ahora usa una base
descartable para cada ensayo. Ambos volvieron a pasar por separado. No se
usaron negocios ni cuentas reales.
La compuerta local segura posterior del hash actual pasó con Prisma,
TypeScript, 491 archivos/7091 pruebas, sistema de diseño y build; 50 archivos
y 545 pruebas omitidos se cuentan aparte. CI remoto del nuevo SHA sigue
pendiente.
