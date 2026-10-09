# Propuesta editorial del primer corte web

Fecha: 2026-09-23. **Borrador sin revisión humana ni publicación.**

[`release-draft.json`](release-draft.json) tiene la forma exacta que acepta
`POST /api/admin/assistant-knowledge/releases`; [`manifest-draft.json`](manifest-draft.json)
fija las referencias de las mismas diez versiones. Hash del manifiesto:
`debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c`.
Los cinco cuerpos de `asistente`, `lotes`, `reposicion`, `salida-proveedor` y
`merma` fueron sustituidos por la redacción solicitada para otra revisión.
`comparacion` conserva su redacción `web2`; `ventas`, `offline`, `compras` y
`contabilidad` conservan sus cuerpos `web1`. Hay cuatro versiones `web1`, cinco
`web2` y una `web3` (`reposicion`). Todos permiten sólo `WEB_INTERNAL`; ninguna de las diez versiones
autoriza `WHATSAPP_PRIVATE`. No se hizo POST, revisión ni publicación.

| Propuestos para revisión | Motivo de atención |
|---|---|
| asistente, lotes, reposicion, salida-proveedor, merma | Cinco cuerpos nuevos; revisar texto completo, roles y recorrido real |
| ventas, offline, compras, contabilidad, comparacion | Cuerpos sin cambios editoriales en esta revisión |

`promociones` y `canal-privado` quedan **fuera de este borrador** porque el
primer corte mantiene esas capacidades apagadas. El corpus `LEGACY` actual
puede mostrarlos hasta que se publique un manifiesto revisado; preparar este
archivo no cambia la ayuda que ven los usuarios. Tras publicar, las consultas
nuevas usan sólo las referencias activas. Las citas `LEGACY` en conversaciones
anteriores pueden seguir abriendo el pasaje histórico mientras sus permisos
continúen vigentes; esta revisión no retira versiones históricas.

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
El ensayo actualizado en MySQL 8 descartable comprobó que «¿Cómo comparar
ventas?» y «¿Cómo reponer productos?» citaron ayuda publicada y no crearon
`AssistantRun` con `operations=false` y `language=true` cuando la interpretación
se sustituyó por un doble local; eso no mide el proveedor real. El ensayo
también verificó cita y apertura de `asistente`, `lotes`, `reposicion` y
`salida-proveedor` para BODEGUERO, rechazo de
`contabilidad` para ese rol y ausencia de `AssistantUsage` por el doble.
`comparacion` mantiene `web2` sin cambios. La allowlist HTTP de BODEGUERO ahora
admite sólo revisión y pasaje de ayuda, y continúa bloqueando rutas financieras.
En una conversación sintética anterior a la publicación simulada, las citas
`LEGACY` de promociones y canal privado siguieron comprobables como históricas
después de activar el manifiesto nuevo; no se retiraron esas versiones.
En una segunda base descartable se reprodujo el orden anterior de CI: ensayo
de dos pilotos primero y ensayo editorial después; ambos aprobaron. El guard
nuevo del piloto exige publicación previa, así que CI ahora usa una base
descartable para cada ensayo. Ambos volvieron a pasar por separado. No se
usaron negocios ni cuentas reales.
El hash nuevo pasó `--verify`, TypeScript y 36 pruebas dirigidas. La compuerta
local segura pasó con 491 archivos/7091 pruebas, diseño y build; 50 archivos y
545 pruebas omitidos se informan aparte. Los ensayos editoriales y del guard
de piloto pasaron en dos bases MySQL 8 descartables independientes. CI remoto
del nuevo commit queda pendiente hasta subirlo al PR borrador.
