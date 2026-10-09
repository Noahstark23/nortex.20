# 2026-09-16 · El descuento sale del modo del POS

**Tipo:** decisión de producto, no corrección de defecto.
**Decidido por:** el negocio, el mismo día del arreglo de la regresión.
**Base:** `main` en `67f1832` (con la regresión del descuento ya reparada).

---

## Qué cambia

El descuento del POS —**global y por línea**— pasa a ser visible **siempre**, en los
dos modos y en todo giro. Deja de depender de `guidedSimpleMode`.

El modo simple **no se vacía**: sigue escondiendo escáner, tiquetera, importación
Excel, "Nuevo" producto completo, saldo de caja, pulso del día y atajos de teclado.
Y la pulpería lo sigue teniendo por defecto.

## Por qué

La reparación de la regresión (`67f1832`) devolvió el descuento a ferretería, farmacia
y distribuidora restaurando el desacople de R2.6. Pero dejó en pie la pregunta que el
desacople nunca respondió: **¿el descuento tenía que estar escondido en el modo
simple, para alguien?**

La respuesta es no, y la pulpería es el caso que lo demuestra. Es el giro que el modo
simple tiene por defecto, y es donde **más** se regatea: *"te lo dejo en 20"*,
*"llevate los dos por 35"*. Un POS de pulpería sin descuento es un POS al que hay que
salirse para hacer la venta más común del día.

El error original fue de **categoría**, y sigue siendo útil nombrarlo:

| | Ejemplos | ¿Esconder en modo simple? |
|---|---|---|
| **Configuración de una vez** | tiquetera, escáner, importación Excel | **Sí** — se tocan una vez y se olvidan |
| **Operación diaria** | descuento | **No** — es lo segundo más frecuente después de cobrar |

El modo simple se diseñó para lo primero. El descuento entró en esa bolsa por
arrastre, no por decisión.

## Qué se tocó

- `components/POS.tsx` — se quita `!guidedSimpleMode` de los dos gates del descuento.
  El de línea conserva `!isQuotationLine`: una cotización mantiene su precio y su
  descuento originales, y eso no cambia.
- `utils/navigation.ts` — el docstring de `resolvePosSimple` deja de listar el
  descuento entre lo que el modo simple esconde.

**Ninguna condición nueva.** Se quitaron dos, no se agregó ninguna: el descuento ya no
depende de nada más que de no ser una línea de cotización.

## Pruebas

`tests/posDescuentoSiempreVisible.test.tsx` (nuevo) monta el POS y fija la conducta.
**Reproducido primero: 4 de 6 casos caen contra el código anterior** —exactamente los
de modo simple— y los 2 que pasaban antes siguen pasando. Cubre pulpería en simple con
descuento global y por línea, quien eligió simple a propósito, ferretería en completo
(que no se rompa lo ya arreglado), que el descuento **rebaje el total** y no sólo
aparezca, y que el modo simple siga escondiendo escáner, tiquetera e importación.

### Una prueba que se renombró, no se debilitó

`tests/posDescuentoModoSimple.test.tsx` → **`tests/posModoSimplePorGiro.test.tsx`**.

Ese archivo usaba el descuento como **sonda** para detectar en qué modo caía cada
giro. Con el descuento fuera del modo, la sonda dejó de marcar: seguir usándola sería
medir con una regla rota. Se le cambió la sonda al rótulo del buscador, que sí depende
del modo:

```
simple   → "Escaneá o buscá un producto"
completo → "Buscar o escanear"
```

**Los 7 casos se conservan y protegen lo mismo:** que nadie vuelva a unificar
`resolvePosSimple` con `resolveUiMode`. Ninguna aserción se debilitó — se cambió una
decisión de producto y su prueba se movió con ella. El nombre del archivo se corrigió
porque `posDescuentoModoSimple` habría quedado afirmando justo lo contrario de lo que
ahora es cierto, y este repositorio ya pagó caro una descripción que sobrevivió al
código que describía.

## QA ejecutado

| Verificación | Resultado |
|---|---|
| Fallo reproducido primero | 4 de 6 casos nuevos caen contra el código anterior |
| Suite completa | **6.291 pasan** · 11 fallan |
| ¿Esos 11 son de este cambio? | **No.** Mismo conjunto exacto que `main`, comparado caso por caso (suites que usan `xlsx`, sin egress en el entorno de QA) |
| `presupuesto` del POS | ✅ **bajó** — se quitaron condiciones, no se agregaron |
| Contraste y semántica de color | ✅ |

### Verificación visual en Chromium

Un cambio que saca un control de un gate puede romper el layout del otro modo, así que
se miró en navegador real, no sólo en jsdom.

Pulpería en **modo simple**, con producto de C$ 60.00 y 25% de descuento global:

- **TOTAL C$ 45.00** (era 60)
- Fila "Descuento Global [25] %" con **−C$ 15.00** en rojo al lado
- Botón "Cobrar C$ 45.00 en efectivo" cuadrando con el total
- Sin solapamiento entre el control y el botón de cobro (medido por *bounding box*)

**Detalle de layout que conviene conocer:** en modo simple el pie del ticket es una
grilla CSS (`posWorkspace.css:99-104`) que coloca `nx-pos-tax-details` y
`nx-pos-total-row` en la fila 1 explícitamente. El bloque del descuento, que no tiene
posición asignada, cae debajo — o sea entre el TOTAL y el botón de cobro, no encima
como en modo completo. Se revisó y **queda bien**: el control está pegado a la acción
que modifica, y la rebaja se muestra en la misma fila. No se tocó la grilla.

## Un hallazgo del propio QA

El guion de verificación visual del cambio anterior reportaba "descuento oculto en
pulpería — OK" **después** de este cambio, contradiciendo a jsdom. No era una
contradicción: el guion esperaba 700 ms tras agregar el producto, y en modo simple eso
abre la hoja del carrito con animación. Contaba el botón antes de que existiera.

Ese guion **habría dado el mismo resultado antes del cambio**, por la misma carrera:
pasaba por la razón equivocada. Queda anotado porque es el mismo patrón que este
expediente documenta —una señal que parece confirmar y en realidad no mide nada— y
porque la verificación visual del repositorio todavía vive fuera del código.

## Límites declarados

- La verificación visual fue contra `/api/*` stubeado, sin MySQL (Docker no disponible
  en el entorno). Acredita render y conducta de UI, no un circuito real contra base;
  eso lo cubre `integration-required` en CI.
- El descuento ahora también aparece en el flujo de **primera venta**
  (`first_sale=1`), que es una pantalla guiada de onboarding. Es consecuencia directa
  de quitar el gate y **no se le hizo una excepción a propósito**: agregar una
  condición escondida ahí sería reintroducir exactamente el patrón que causó todo
  esto. Si el negocio prefiere que la primera venta no lo muestre, que sea un cambio
  propio y declarado.
- **Sigue sin haber pruebas de navegador en el repositorio.** La verificación de
  arriba se hizo con un guion en scratchpad: acredita este candidato y no deja red
  para el próximo.
- Este cambio no autoriza staging ni producción: compuertas separadas
  (`docs/runbooks/release-promotion.md`).
