# 2026-09-16 · El descuento del POS desapareció para ferretería, farmacia y distribuidora

**Reportado por:** el negocio, no por una prueba ni por CI.
**Síntoma:** "el descuento del POS desapareció".
**Alcance:** todo tenant retail que **nunca tocó** el toggle de menú, salvo pulpería
y prestamista. Ferreterías, farmacias, distribuidoras y misceláneas con clientes reales.
**Duración:** desde `944cc94` (2026-08-22) hasta este arreglo. Alrededor de tres semanas
y media en el código; la ventana en producción depende de cuándo se promovió cada
candidato y **no se acredita acá**.
**Candidato del arreglo:** rama `claude/pos-descuento-modo-simple`, desde `main` en `98e54af`.

---

## Qué se rompió

Nada se borró. Los dos descuentos del POS —el global y el de línea— viven detrás de
la misma condición:

| Control | Archivo | Condición |
|---|---|---|
| Descuento por línea ("Aplicar descuento") | `components/POS.tsx` | `!guidedSimpleMode && !isQuotationLine` |
| Descuento Global | `components/POS.tsx` | `!guidedSimpleMode` |

`guidedSimpleMode` pasó a ser `true` por defecto para casi todos los giros. El
descuento quedó escondido sin que nadie lo pidiera ni lo notara.

## Por qué el diseño lo había previsto — y aun así pasó

R2.6 (`12d91eb`, 2026-08-11) llevó el **menú** a simple para todo giro retail. En el
mismo commit se vio el riesgo sobre el POS y se creó `resolvePosSimple` para
separarlo, con el porqué escrito en el propio mensaje del commit:

> *"resolvePosSimple (nuevo, QA): el POS se desacopla del menú — su default simple
> sigue siendo solo pulpería, porque el modo simple del POS esconde tiquetera,
> parqueo, devoluciones e importación y ocultárselos a una ferretería habría sido
> una regresión real de mostrador."*

El desacople quedó funcionando. Después se deshizo en dos pasos:

| Commit | Fecha | Qué hizo |
|---|---|---|
| `12d91eb` (R2.6) | 2026-08-11 | Crea `resolvePosSimple` (`=== 'PULPERIA'`) y cablea el POS. **Correcto.** |
| `944cc94` | 2026-08-22 | **Rompe la conducta.** Invierte el cuerpo a `!== 'LENDER'` y **borra el comentario** que explicaba el desacople, reemplazándolo por un argumento sobre Square/Shopify. Mismo commit agrega el gate `!guidedSimpleMode` al descuento de línea. |
| `5c5d307` | 2026-09-04 | El POS deja de llamarla y vuelve a `useUiMode()`. Ya no cambia nada: ambas funciones devolvían simple para todos. `resolvePosSimple` queda como **código muerto**. |

`944cc94` se llama *"feat(retail): support measured products and scale labels"*.
La política de modo del POS no tiene relación con productos por peso.

## Por qué ninguna compuerta lo agarró

Vale enumerarlo, porque es lo reutilizable del episodio:

1. **La justificación se reescribió junto con el código.** El comentario que decía
   "no unifiques esto" fue reemplazado por uno que argumentaba lo contrario, en el
   mismo diff. Quien revisara después leía una decisión coherente.
2. **No había prueba de conducta.** `resolvePosSimple` nunca tuvo test propio; y aun
   si lo hubiera tenido, habría seguido en verde durante `5c5d307`, porque el POS ni
   la llamaba. Una prueba sobre la función aislada no cubría el flujo.
3. **Los fixtures tapaban el cambio.** `posVentaCritica` y `promotionCheckout` montan
   el POS con un tenant **sin `type`**. Con la política rota, `''` caía en simple, que
   es el modo contra el que esos tests estaban escritos. Pasaban en verde *gracias* al
   bug. Un fixture que no declara el dato del que depende la pantalla no protege nada.
4. **La ausencia de un control no rompe nada.** Un descuento que no se ve no tira
   excepción, no mueve un total, no deja rastro en un log. La única alarma posible
   era humana, y llegó por ahí.

## El arreglo

- `utils/navigation.ts` — `resolvePosSimple` vuelve a `=== 'PULPERIA'`, con el porqué
  del desacople restaurado y una nota explícita de no volver a unificarlo.
- `hooks/useUiMode.ts` — nuevo `usePosSimpleMode()`. Comparte almacenamiento y
  suscripción con `useUiMode` (el toggle del sidebar sigue moviendo el POS al
  instante), pero resuelve con la política del POS. El snapshot de servidor devuelve
  `false`: en prerender no hay `localStorage`, y equivocarse hacia "completo" muestra
  un control de más por un instante, mientras que equivocarse hacia "simple" esconde
  el descuento.
- `components/POS.tsx` — consume `usePosSimpleMode()` en vez de `useUiMode()`.

**La elección explícita del usuario sigue mandando en los dos sentidos.** Quien pidió
modo simple conserva modo simple; quien pidió completo, completo.

### Un bug latente que salió de paso

Al volver alcanzable el modo completo apareció `components/POS.tsx` con
`currentShift.employee.firstName[0]`. Si al empleado del turno le falta el nombre,
**revienta el POS entero** —pantalla en blanco, no un avatar vacío—. El bloque solo
se renderiza en modo completo, así que estaba dormido mientras el modo completo era
inalcanzable por defecto.

**No se demostró que sea alcanzable en producción.** `GET /api/shifts/current`
(`backend/server.ts:4973`) incluye `firstName`/`lastName`, en el schema son `String`
no-nulos, y `POST /api/shifts/open` devuelve el `create` **sin `include`**, así que
`employee` viene ausente y el guard `currentShift?.employee &&` corta antes. Se blindó
igual con encadenamiento opcional: el branch acaba de volverse alcanzable para la
mayoría de los tenants y el radio de daño es la pantalla completa.

## QA ejecutado

**El fallo se reprodujo primero.** `tests/posDescuentoModoSimple.test.tsx` monta el POS
de verdad y mira si el cajero puede aplicar un descuento. Contra el código roto caen
3 de 7 —ferretería, farmacia y distribuidora—; los otros 4 (elección explícita en los
dos sentidos, pulpería por defecto, prestamista) pasan antes y después.

| Verificación | Resultado |
|---|---|
| Suite completa | 6.278 pasan · 11 fallan |
| ¿Esos 11 son míos? | **No.** Mismo conjunto exacto en `main` (`98e54af`), comparado por nombre de caso |
| `tsc --noEmit` | Limpio salvo el bloqueo conocido de `xlsx`; ninguno en archivos tocados |
| Presupuestos POS y backend | Verdes — el del POS **no se subió** (ver abajo) |
| `check:design` | Íntegro, 113 archivos |
| Contraste y semántica de color | Verdes |

Los 11 fallos son de suites que usan `xlsx` de verdad (`bodegaCatalogImporter`,
`measuredReportExport`, `salesReportsRoute`, `xlsxRuntime`). El paquete está pineado a
`cdn.sheetjs.com` y el entorno de QA no tiene egress, así que se corrió con un stub
local; el stub las hace tronar. En CI, con el paquete real, corresponde que pasen.

### Presupuesto del POS

El primer intento agregó 2 líneas a `POS.tsx` y el trinquete falló en 5.897 > 5.895.
**No se subió el presupuesto.** Se acortó el comentario y el razonamiento quedó donde
corresponde: en el docstring de `resolvePosSimple` y en el hook. `POS.tsx` vuelve a
5.895.

### Fixtures corregidos

Tres tests dependían de que el POS arrancara simple para todos:

- `posVentaCritica` y `promotionCheckout` — se les declara el giro que su propio
  fixture ya decía ser (`PULPERIA`). Ninguna aserción se tocó ni se debilitó.
- `assistantPanel` — su fixture sí declara `FERRETERIA` a propósito, así que ahí se
  hicieron agnósticos al modo los dos selectores de rótulo (buscador y botón de cobro),
  **conservando el monto**, que es lo que el caso verifica. Su tema es el bloqueo de
  atajos de NortexGPT, no el modo del POS.

## Límites declarados

- **No se verificó en un navegador real.** jsdom no calcula layout. La confirmación de
  que el cajero ve el descuento en una ferretería es mirarlo; corresponde la revisión
  visual de `docs/runbooks/frontend-preprod-audit.md`.
- **La ventana real en producción no está acreditada.** Se conoce la ventana en el
  código (desde `944cc94`); cuándo llegó a cada tenant depende de las promociones, y
  eso se establece con `docs/releases/` y el historial de despliegues, no con este
  documento.
- **No se auditó qué más se perdió.** El modo simple también esconde tiquetera,
  parqueo, devoluciones e importación. Este arreglo se las devuelve a esos giros junto
  con el descuento, pero **no se revisó uno por uno** que cada uno funcione bien ahí.
  Queda pendiente y se declara: no es lo mismo que un control vuelva a estar visible a
  que esté verificado.
- **La pulpería sigue sin descuento por defecto.** Es la conducta original de R2.6 y se
  conserva a propósito, con prueba que la fija. Si el negocio decide que la pulpería
  también lo necesita —que es discutible, porque ahí se regatea— debe ser un cambio
  propio con su decisión, no un efecto colateral de este.
- Este PR no autoriza staging ni producción: son compuertas separadas
  (`docs/runbooks/release-promotion.md`).

## Para que no vuelva a pasar

- `tests/posDescuentoModoSimple.test.tsx` fija la conducta por giro montando el POS,
  no la fórmula. Si alguien vuelve a unificar las políticas, el test cae.
- El docstring de `resolvePosSimple` nombra el commit que lo rompió y por qué.
- Los fixtures del POS declaran el giro. Un test que monta el POS y no dice de qué
  negocio es, no está probando el POS de nadie.
